import { Router } from "express";
import * as Y from "yjs";
import { db, newId, newInviteCode, transaction } from "../db.js";
import { HttpError, requireAuth, requireRole } from "../auth.js";
import { buildTemplateDoc, evictDoc, getDoc, recordInitialSnapshot } from "../collab/docs.js";
import { applyRoleChange } from "../collab/ws.js";
import { exportFiles, applyFiles } from "../collab/model.js";
import { TEMPLATES } from "../collab/templates.js";

const router = Router();
router.use(requireAuth);

const listStmt = db.prepare(`
  SELECT p.id, p.name, p.description, p.template, p.owner_id, p.created_at, p.updated_at, m.role
  FROM projects p JOIN members m ON m.project_id = p.id
  WHERE m.user_id = ?
  ORDER BY p.updated_at DESC
`);
const membersStmt = db.prepare(`
  SELECT u.id, u.name, u.email, u.color, m.role, m.joined_at, m.last_seen_at
  FROM members m JOIN users u ON u.id = m.user_id
  WHERE m.project_id = ?
  ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, m.joined_at
`);
const statsStmt = db.prepare(`
  SELECT COUNT(*) AS snapshots, MAX(created_at) AS last_activity,
         SUM(CASE WHEN kind = 'checkpoint' THEN 1 ELSE 0 END) AS checkpoints
  FROM snapshots WHERE project_id = ?
`);
const insertProject = db.prepare(`
  INSERT INTO projects (id, name, description, template, owner_id, invite_code, ydoc, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertMember = db.prepare(
  "INSERT INTO members (project_id, user_id, role, joined_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
);
const byInvite = db.prepare("SELECT id FROM projects WHERE invite_code = ?");
const memberRow = db.prepare("SELECT role FROM members WHERE project_id = ? AND user_id = ?");

const serializeMember = (m) => ({
  id: m.id,
  name: m.name,
  email: m.email,
  color: m.color,
  role: m.role,
  joinedAt: m.joined_at,
  lastSeenAt: m.last_seen_at,
});

function serializeProject(p, { includeMembers = true } = {}) {
  const stats = statsStmt.get(p.id);
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    template: p.template,
    ownerId: p.owner_id,
    role: p.role,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    inviteCode: p.role === "viewer" ? null : p.invite_code,
    snapshotCount: stats.snapshots ?? 0,
    checkpointCount: stats.checkpoints ?? 0,
    members: includeMembers ? membersStmt.all(p.id).map(serializeMember) : undefined,
  };
}

function cleanName(raw) {
  const name = String(raw ?? "").trim();
  if (name.length < 1 || name.length > 60) throw new HttpError(400, "Project name should be 1–60 characters.");
  return name;
}

function createProject({ name, description, template, ownerId, state, files }) {
  const id = newId();
  const now = Date.now();
  transaction(() => {
    insertProject.run(id, name, description, template, ownerId, newInviteCode(), state, now, now);
    insertMember.run(id, ownerId, "owner", now, now);
  });
  recordInitialSnapshot(id, files, ownerId);
  return id;
}

router.get("/", (req, res) => {
  const rows = listStmt.all(req.user.id);
  res.json({ projects: rows.map((p) => serializeProject({ ...p, invite_code: null })) });
});

router.get("/templates", (_req, res) => {
  res.json({
    templates: Object.entries(TEMPLATES).map(([key, t]) => ({
      key,
      label: t.label,
      entry: t.entry,
      files: t.files.map((f) => f.path),
    })),
  });
});

router.post("/", (req, res) => {
  const name = cleanName(req.body?.name);
  const description = String(req.body?.description ?? "").slice(0, 280);
  const template = TEMPLATES[req.body?.template] ? req.body.template : "blank";
  const { state, files } = buildTemplateDoc(template);
  const id = createProject({ name, description, template, ownerId: req.user.id, state, files });
  const project = db.prepare("SELECT p.*, 'owner' AS role FROM projects p WHERE id = ?").get(id);
  res.status(201).json({ project: serializeProject(project) });
});

router.post("/join", (req, res) => {
  const code = String(req.body?.code ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const formatted = `${code.slice(0, 4)}-${code.slice(4, 8)}`;
  const project = byInvite.get(formatted);
  if (!project) throw new HttpError(404, "No project matches that invite code.");
  const existing = memberRow.get(project.id, req.user.id);
  if (!existing) {
    insertMember.run(project.id, req.user.id, "editor", Date.now(), null);
    getDoc(project.id)?.onBroadcast?.({ type: "members" });
  }
  res.json({ projectId: project.id, alreadyMember: Boolean(existing) });
});

router.get("/:projectId", requireRole("viewer"), (req, res) => {
  res.json({ project: serializeProject(req.project) });
});

router.patch("/:projectId", requireRole("editor"), (req, res) => {
  const name = req.body?.name !== undefined ? cleanName(req.body.name) : req.project.name;
  const description = req.body?.description !== undefined ? String(req.body.description).slice(0, 280) : req.project.description;
  db.prepare("UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ?").run(
    name,
    description,
    Date.now(),
    req.project.id,
  );
  const doc = getDoc(req.project.id);
  doc?.onBroadcast?.({ type: "project", name, description });
  res.json({ project: serializeProject({ ...req.project, name, description }) });
});

router.delete("/:projectId", requireRole("owner"), (req, res) => {
  evictDoc(req.project.id);
  db.prepare("DELETE FROM projects WHERE id = ?").run(req.project.id);
  res.json({ ok: true });
});

router.post("/:projectId/duplicate", requireRole("viewer"), (req, res) => {
  const doc = getDoc(req.project.id);
  const files = exportFiles(doc);
  const copy = new Y.Doc();
  applyFiles(copy, files);
  const state = Y.encodeStateAsUpdate(copy);
  copy.destroy();
  const name = String(req.body?.name ?? `${req.project.name} (fork)`).slice(0, 60);
  const id = createProject({
    name,
    description: req.project.description,
    template: req.project.template,
    ownerId: req.user.id,
    state,
    files,
  });
  res.status(201).json({ projectId: id });
});

router.post("/:projectId/invite/regenerate", requireRole("owner"), (req, res) => {
  const code = newInviteCode();
  db.prepare("UPDATE projects SET invite_code = ? WHERE id = ?").run(code, req.project.id);
  res.json({ inviteCode: code });
});

router.patch("/:projectId/members/:userId", requireRole("owner"), (req, res) => {
  const role = req.body?.role;
  if (!["editor", "viewer"].includes(role)) throw new HttpError(400, "Role must be editor or viewer.");
  if (req.params.userId === req.user.id) throw new HttpError(400, "You can't change your own role.");
  const target = memberRow.get(req.project.id, req.params.userId);
  if (!target) throw new HttpError(404, "That person isn't a member.");
  if (target.role === "owner") throw new HttpError(400, "The owner's role can't be changed.");
  db.prepare("UPDATE members SET role = ? WHERE project_id = ? AND user_id = ?").run(role, req.project.id, req.params.userId);
  const doc = getDoc(req.project.id);
  if (doc) applyRoleChange(doc, req.params.userId, role);
  doc?.onBroadcast?.({ type: "members" });
  res.json({ members: membersStmt.all(req.project.id).map(serializeMember) });
});

router.delete("/:projectId/members/:userId", requireRole("viewer"), (req, res) => {
  const leaving = req.params.userId === req.user.id;
  if (!leaving && req.project.role !== "owner") throw new HttpError(403, "Only the owner can remove people.");
  const target = memberRow.get(req.project.id, req.params.userId);
  if (!target) throw new HttpError(404, "That person isn't a member.");
  if (target.role === "owner") throw new HttpError(400, "The owner can't leave — delete the project instead.");
  db.prepare("DELETE FROM members WHERE project_id = ? AND user_id = ?").run(req.project.id, req.params.userId);
  const doc = getDoc(req.project.id);
  if (doc) applyRoleChange(doc, req.params.userId, null);
  doc?.onBroadcast?.({ type: "members" });
  res.json({ ok: true });
});

export default router;
