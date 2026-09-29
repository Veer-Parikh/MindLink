import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import { diffLines } from "diff";
import { db } from "../db.js";
import { config } from "../config.js";
import { applyFiles, exportFiles, hashFiles, filesFromPaths } from "./model.js";
import { TEMPLATES } from "./templates.js";

const loadStmt = db.prepare("SELECT ydoc FROM projects WHERE id = ?");
const saveStmt = db.prepare("UPDATE projects SET ydoc = ?, updated_at = ? WHERE id = ?");
const lastSnapshotStmt = db.prepare("SELECT id, hash, files FROM snapshots WHERE project_id = ? ORDER BY id DESC LIMIT 1");
const insertSnapshotStmt = db.prepare(`
  INSERT INTO snapshots (project_id, kind, message, author_ids, files, hash, added, removed, created_by, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

/** Line-level churn between two exported file lists. */
export function diffStats(prevFiles, nextFiles) {
  const prev = new Map(prevFiles.filter((f) => f.type === "file").map((f) => [f.id, f.content ?? ""]));
  let added = 0;
  let removed = 0;
  const count = (s) => (s ? s.split("\n").length - (s.endsWith("\n") ? 1 : 0) : 0);
  for (const f of nextFiles) {
    if (f.type !== "file") continue;
    const before = prev.get(f.id);
    prev.delete(f.id);
    if (before === undefined) {
      added += count(f.content);
      continue;
    }
    if (before === f.content) continue;
    for (const part of diffLines(before, f.content ?? "")) {
      if (part.added) added += part.count ?? count(part.value);
      else if (part.removed) removed += part.count ?? count(part.value);
    }
  }
  for (const leftover of prev.values()) removed += count(leftover);
  return { added, removed };
}

export class ProjectDoc extends Y.Doc {
  constructor(projectId) {
    super({ gc: true });
    this.projectId = projectId;
    /** @type {Map<import("ws").WebSocket, { user: any, role: string, awarenessIds: Set<number> }>} */
    this.conns = new Map();
    this.awareness = new awarenessProtocol.Awareness(this);
    this.awareness.setLocalState(null);
    this.pendingAuthors = new Set();
    this.saveTimer = null;
    this.snapshotTimer = null;
    this.snapshotDeadline = null;
    this.unloadTimer = null;
    this.onBroadcast = null; // set by the websocket layer

    this.on("update", (_update, origin) => {
      this.scheduleSave();
      const author = origin && this.conns.get(origin)?.user?.id;
      if (author) {
        this.pendingAuthors.add(author);
        this.scheduleSnapshot();
      }
    });
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.persist(), 1200);
  }

  persist() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    saveStmt.run(Y.encodeStateAsUpdate(this), Date.now(), this.projectId);
  }

  scheduleSnapshot() {
    const now = Date.now();
    if (!this.snapshotDeadline) this.snapshotDeadline = now + config.snapshotMaxWaitMs;
    const wait = Math.max(0, Math.min(config.snapshotDebounceMs, this.snapshotDeadline - now));
    clearTimeout(this.snapshotTimer);
    this.snapshotTimer = setTimeout(() => this.snapshot("auto"), wait);
  }

  /**
   * Records the current state on the Rewind timeline. Auto snapshots are skipped when nothing changed;
   * checkpoints are always recorded because they carry a message.
   */
  snapshot(kind, { message = null, createdBy = null, authors = null } = {}) {
    clearTimeout(this.snapshotTimer);
    this.snapshotTimer = null;
    this.snapshotDeadline = null;

    const files = exportFiles(this);
    const hash = hashFiles(files);
    const last = lastSnapshotStmt.get(this.projectId);
    if (kind === "auto" && last?.hash === hash) {
      this.pendingAuthors.clear();
      return null;
    }
    const { added, removed } = last ? diffStats(JSON.parse(last.files), files) : diffStats([], files);
    const authorIds = authors ?? Array.from(this.pendingAuthors);
    if (createdBy && !authorIds.includes(createdBy)) authorIds.push(createdBy);
    this.pendingAuthors.clear();

    const createdAt = Date.now();
    const { lastInsertRowid } = insertSnapshotStmt.run(
      this.projectId,
      kind,
      message,
      JSON.stringify(authorIds),
      JSON.stringify(files),
      hash,
      added,
      removed,
      createdBy,
      createdAt,
    );
    this.persist();
    const summary = {
      id: Number(lastInsertRowid),
      kind,
      message,
      authorIds,
      added,
      removed,
      createdBy,
      createdAt,
      fileCount: files.filter((f) => f.type === "file").length,
    };
    this.onBroadcast?.({ type: "snapshot", snapshot: summary });
    return summary;
  }

  /** Flush timers & state; called before the doc is evicted from memory. */
  close() {
    if (this.snapshotTimer) this.snapshot("auto");
    if (this.saveTimer) this.persist();
    clearTimeout(this.unloadTimer);
    this.awareness.destroy();
    this.destroy();
  }
}

const docs = new Map();

export function getDoc(projectId) {
  let doc = docs.get(projectId);
  if (doc) {
    clearTimeout(doc.unloadTimer);
    doc.unloadTimer = null;
    if (doc.conns.size === 0) scheduleUnload(doc);
    return doc;
  }
  const row = loadStmt.get(projectId);
  if (!row) return null;
  doc = new ProjectDoc(projectId);
  if (row.ydoc) Y.applyUpdate(doc, row.ydoc);
  docs.set(projectId, doc);
  scheduleUnload(doc);
  return doc;
}

export function scheduleUnload(doc) {
  clearTimeout(doc.unloadTimer);
  doc.unloadTimer = setTimeout(() => {
    if (doc.conns.size > 0) return;
    docs.delete(doc.projectId);
    doc.close();
  }, 30_000);
}

export function evictDoc(projectId) {
  const doc = docs.get(projectId);
  if (!doc) return;
  for (const conn of doc.conns.keys()) conn.close(4404, "Project deleted");
  docs.delete(projectId);
  clearTimeout(doc.saveTimer);
  clearTimeout(doc.snapshotTimer);
  clearTimeout(doc.unloadTimer);
  doc.awareness.destroy();
  doc.destroy();
}

/** Seeds a brand new project's Y.Doc from a template, returning the encoded state. */
export function buildTemplateDoc(templateKey) {
  const template = TEMPLATES[templateKey] ?? TEMPLATES.blank;
  const doc = new Y.Doc();
  const files = filesFromPaths(template.files);
  applyFiles(doc, files);
  const state = Y.encodeStateAsUpdate(doc);
  const exported = exportFiles(doc);
  doc.destroy();
  return { state, files: exported };
}

export function recordInitialSnapshot(projectId, files, userId) {
  const { added } = diffStats([], files);
  insertSnapshotStmt.run(
    projectId,
    "initial",
    "Project created",
    JSON.stringify([userId]),
    JSON.stringify(files),
    hashFiles(files),
    added,
    0,
    userId,
    Date.now(),
  );
}

export function flushAll() {
  for (const doc of docs.values()) doc.close();
  docs.clear();
}
