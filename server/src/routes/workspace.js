import { Router } from "express";
import crypto from "node:crypto";
import { db } from "../db.js";
import { HttpError, requireAuth, requireRole } from "../auth.js";
import { diffStats, getDoc } from "../collab/docs.js";
import { applyFiles, chat, exportFiles, runs, threads } from "../collab/model.js";

const router = Router({ mergeParams: true });
router.use(requireAuth);

const timelineStmt = db.prepare(`
  SELECT id, kind, message, author_ids, added, removed, created_by, created_at
  FROM snapshots WHERE project_id = ? ORDER BY id ASC
`);
const snapshotStmt = db.prepare("SELECT * FROM snapshots WHERE project_id = ? AND id = ?");
const baselineStmt = db.prepare(`
  SELECT * FROM snapshots WHERE project_id = ? AND created_at <= ? ORDER BY id DESC LIMIT 1
`);
const sinceStmt = db.prepare(`
  SELECT id, kind, message, author_ids, added, removed, created_at
  FROM snapshots WHERE project_id = ? AND created_at > ? ORDER BY id ASC
`);
const usersStmt = db.prepare(`
  SELECT u.id, u.name, u.color FROM users u JOIN members m ON m.user_id = u.id WHERE m.project_id = ?
`);

const summarize = (row) => ({
  id: row.id,
  kind: row.kind,
  message: row.message,
  authorIds: JSON.parse(row.author_ids),
  added: row.added,
  removed: row.removed,
  createdBy: row.created_by ?? null,
  createdAt: row.created_at,
});

const shortId = () => crypto.randomBytes(6).toString("base64url");
const author = (user) => ({ userId: user.id, name: user.name, color: user.color });

// ───────────────────────────── Rewind timeline ─────────────────────────────

router.get("/timeline", requireRole("viewer"), (req, res) => {
  res.json({ snapshots: timelineStmt.all(req.project.id).map(summarize) });
});

router.get("/snapshots/:snapshotId", requireRole("viewer"), (req, res) => {
  const row = snapshotStmt.get(req.project.id, Number(req.params.snapshotId));
  if (!row) throw new HttpError(404, "Snapshot not found.");
  res.json({ snapshot: { ...summarize(row), files: JSON.parse(row.files) } });
});

router.post("/checkpoints", requireRole("editor"), (req, res) => {
  const message = String(req.body?.message ?? "").trim();
  if (!message) throw new HttpError(400, "Give your checkpoint a short message.");
  if (message.length > 200) throw new HttpError(400, "Keep checkpoint messages under 200 characters.");
  const doc = getDoc(req.project.id);
  const snapshot = doc.snapshot("checkpoint", { message, createdBy: req.user.id });
  res.status(201).json({ snapshot });
});

router.post("/snapshots/:snapshotId/restore", requireRole("editor"), (req, res) => {
  const row = snapshotStmt.get(req.project.id, Number(req.params.snapshotId));
  if (!row) throw new HttpError(404, "Snapshot not found.");
  const doc = getDoc(req.project.id);
  if (doc.snapshotTimer) doc.snapshot("auto"); // keep the pre-restore state on the timeline
  applyFiles(doc, JSON.parse(row.files), "restore");
  const label = row.message ? `“${row.message}”` : new Date(row.created_at).toLocaleString("en-US");
  const snapshot = doc.snapshot("restore", {
    message: `Restored to ${label}`,
    createdBy: req.user.id,
    authors: [req.user.id],
  });
  doc.onBroadcast?.({ type: "restored", by: author(req.user), snapshotId: row.id });
  res.json({ snapshot });
});

// ───────────────────────────── Catch up ─────────────────────────────

/** What changed in the project since the caller was last here (other people's work only). */
export function computeCatchup(project, userId) {
  const since = project.last_seen_at;
  if (!since) return { since: null, changes: [], authors: [], checkpoints: [], snapshotCount: 0 };
  const after = sinceStmt.all(project.id, since).map(summarize);
  const byOthers = after.filter((s) => s.authorIds.some((id) => id !== userId));
  if (byOthers.length === 0) return { since, changes: [], authors: [], checkpoints: [], snapshotCount: 0 };

  const baselineRow = baselineStmt.get(project.id, since);
  const baseline = baselineRow ? JSON.parse(baselineRow.files) : [];
  const current = exportFiles(getDoc(project.id));
  const before = new Map(baseline.filter((f) => f.type === "file").map((f) => [f.id, f]));
  const changes = [];
  for (const f of current) {
    if (f.type !== "file") continue;
    const prev = before.get(f.id);
    before.delete(f.id);
    if (!prev) changes.push({ path: f.path, status: "added", ...diffStats([], [f]) });
    else if (prev.content !== f.content || prev.path !== f.path) {
      changes.push({
        path: f.path,
        previousPath: prev.path !== f.path ? prev.path : undefined,
        status: prev.content !== f.content ? "modified" : "renamed",
        ...diffStats([prev], [f]),
      });
    }
  }
  for (const gone of before.values())
    changes.push({ path: gone.path, status: "deleted", added: 0, removed: diffStats([gone], []).removed });

  const users = new Map(usersStmt.all(project.id).map((u) => [u.id, u]));
  const authorIds = new Set(byOthers.flatMap((s) => s.authorIds).filter((id) => id !== userId));
  return {
    since,
    snapshotCount: byOthers.length,
    authors: Array.from(authorIds)
      .map((id) => users.get(id))
      .filter(Boolean),
    checkpoints: after
      .filter((s) => s.kind === "checkpoint")
      .map((s) => ({ message: s.message, createdAt: s.createdAt, by: users.get(s.createdBy)?.name })),
    changes,
    files: { baseline, current },
  };
}

router.get("/catchup", requireRole("viewer"), (req, res) => {
  const { files, ...rest } = computeCatchup(req.project, req.user.id);
  res.json({ catchup: { ...rest, baselineSnapshotAvailable: Boolean(files) } });
});

// ───────────────────────────── Chat & shared run log ─────────────────────────────

router.post("/chat", requireRole("viewer"), (req, res) => {
  const text = String(req.body?.text ?? "").trim();
  if (!text) throw new HttpError(400, "Message is empty.");
  if (text.length > 2000) throw new HttpError(400, "Message is too long.");
  const doc = getDoc(req.project.id);
  const list = chat(doc);
  doc.transact(() => {
    list.push([{ id: shortId(), ...author(req.user), text, ts: Date.now() }]);
    if (list.length > 500) list.delete(0, list.length - 500);
  }, "server");
  res.status(201).json({ ok: true });
});

router.post("/runs", requireRole("viewer"), (req, res) => {
  const body = req.body ?? {};
  const doc = getDoc(req.project.id);
  const list = runs(doc);
  const entry = {
    id: shortId(),
    ...author(req.user),
    fileId: String(body.fileId ?? ""),
    path: String(body.path ?? "").slice(0, 300),
    language: String(body.language ?? "").slice(0, 40),
    output: String(body.output ?? "").slice(0, 20_000),
    ok: Boolean(body.ok),
    ms: Number(body.ms) || 0,
    ts: Date.now(),
  };
  doc.transact(() => {
    list.push([entry]);
    if (list.length > 30) list.delete(0, list.length - 30);
  }, "server");
  res.status(201).json({ run: entry });
});

// ───────────────────────────── Code threads (line comments) ─────────────────────────────

router.post("/threads", requireRole("viewer"), (req, res) => {
  const text = String(req.body?.text ?? "").trim();
  if (!text) throw new HttpError(400, "Comment is empty.");
  const doc = getDoc(req.project.id);
  const fileId = String(req.body?.fileId ?? "");
  if (!doc.getMap("tree").has(fileId)) throw new HttpError(404, "That file no longer exists.");
  const id = shortId();
  const thread = {
    id,
    fileId,
    anchor: req.body?.anchor ?? null, // Y.RelativePosition JSON — survives concurrent edits
    line: Number(req.body?.line) || 1,
    quote: String(req.body?.quote ?? "").slice(0, 200),
    resolved: false,
    createdAt: Date.now(),
    comments: [{ id: shortId(), ...author(req.user), text: text.slice(0, 2000), ts: Date.now() }],
  };
  threads(doc).set(id, thread);
  res.status(201).json({ thread });
});

function loadThread(req) {
  const doc = getDoc(req.project.id);
  const thread = threads(doc).get(req.params.threadId);
  if (!thread) throw new HttpError(404, "Thread not found.");
  return { doc, thread };
}

router.post("/threads/:threadId/comments", requireRole("viewer"), (req, res) => {
  const text = String(req.body?.text ?? "").trim();
  if (!text) throw new HttpError(400, "Comment is empty.");
  const { doc, thread } = loadThread(req);
  const next = {
    ...thread,
    resolved: false,
    comments: [...thread.comments, { id: shortId(), ...author(req.user), text: text.slice(0, 2000), ts: Date.now() }],
  };
  threads(doc).set(thread.id, next);
  res.status(201).json({ thread: next });
});

router.patch("/threads/:threadId", requireRole("viewer"), (req, res) => {
  const { doc, thread } = loadThread(req);
  const next = { ...thread, resolved: Boolean(req.body?.resolved) };
  if (req.body?.line) next.line = Number(req.body.line) || thread.line;
  threads(doc).set(thread.id, next);
  res.json({ thread: next });
});

router.delete("/threads/:threadId", requireRole("viewer"), (req, res) => {
  const { doc, thread } = loadThread(req);
  const starter = thread.comments[0]?.userId;
  if (starter !== req.user.id && req.project.role !== "owner") {
    throw new HttpError(403, "Only the person who started the thread (or the owner) can delete it.");
  }
  threads(doc).delete(thread.id);
  res.json({ ok: true });
});

// Plain-JSON export of the current files (the client zips it).
router.get("/files", requireRole("viewer"), (req, res) => {
  res.json({ files: exportFiles(getDoc(req.project.id)) });
});

export default router;
