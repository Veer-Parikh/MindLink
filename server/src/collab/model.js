/**
 * Shape of a MindLink project inside its Y.Doc (mirrored in client/src/collab/model.js):
 *
 *   tree     Y.Map<id, { id, name, parentId, type: "file" | "folder" }>
 *   content  Y.Map<id, Y.Text>                 one Y.Text per file
 *   chat     Y.Array<{ id, userId, name, color, text, ts }>
 *   runs     Y.Array<{ id, userId, name, color, fileId, path, language, output, ok, ms, ts }>
 *   threads  Y.Map<id, { id, fileId, anchor, line, resolved, comments: [...] }>
 *
 * Chat, runs and threads are only written by the server (via REST), so authorship can't be forged
 * and read-only viewers can still participate.
 */
import crypto from "node:crypto";
import * as Y from "yjs";

export const tree = (doc) => doc.getMap("tree");
export const content = (doc) => doc.getMap("content");
export const chat = (doc) => doc.getArray("chat");
export const runs = (doc) => doc.getArray("runs");
export const threads = (doc) => doc.getMap("threads");

export const newNodeId = () => crypto.randomBytes(6).toString("base64url");

export function pathOf(treeMap, id) {
  const parts = [];
  let node = treeMap.get(id);
  let guard = 0;
  while (node && guard++ < 64) {
    parts.unshift(node.name);
    node = node.parentId ? treeMap.get(node.parentId) : null;
  }
  return parts.join("/");
}

/** Flattens the project into a serialisable, path-sorted list of nodes. */
export function exportFiles(doc) {
  const t = tree(doc);
  const c = content(doc);
  const out = [];
  t.forEach((node, id) => {
    const entry = { id, name: node.name, parentId: node.parentId ?? null, type: node.type, path: pathOf(t, id) };
    if (node.type === "file") entry.content = c.get(id)?.toString() ?? "";
    out.push(entry);
  });
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

export function hashFiles(files) {
  const h = crypto.createHash("sha1");
  for (const f of files) h.update(`${f.path}\u0000${f.type}\u0000${f.content ?? ""}\u0001`);
  return h.digest("hex");
}

/** Replaces a Y.Text's content with `next`, touching only the changed middle so remote cursors survive. */
export function setText(ytext, next) {
  const prev = ytext.toString();
  if (prev === next) return;
  let start = 0;
  const minLen = Math.min(prev.length, next.length);
  while (start < minLen && prev[start] === next[start]) start++;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--;
    endNext--;
  }
  if (endPrev > start) ytext.delete(start, endPrev - start);
  if (endNext > start) ytext.insert(start, next.slice(start, endNext));
}

/** Makes the doc's files match `files` exactly (used by restore + template seeding). */
export function applyFiles(doc, files, origin = null) {
  doc.transact(() => {
    const t = tree(doc);
    const c = content(doc);
    const wanted = new Map(files.map((f) => [f.id, f]));
    for (const id of Array.from(t.keys())) {
      if (!wanted.has(id)) {
        t.delete(id);
        c.delete(id);
      }
    }
    for (const f of files) {
      const node = { id: f.id, name: f.name, parentId: f.parentId ?? null, type: f.type };
      const existing = t.get(f.id);
      if (!existing || existing.name !== node.name || existing.parentId !== node.parentId || existing.type !== node.type) {
        t.set(f.id, node);
      }
      if (f.type === "file") {
        let text = c.get(f.id);
        if (!text) {
          text = new Y.Text();
          c.set(f.id, text);
        }
        setText(text, f.content ?? "");
      }
    }
  }, origin);
}

/** Builds node list from `{ path, content }` pairs, creating intermediate folders. */
export function filesFromPaths(entries) {
  const folders = new Map();
  const out = [];
  const folderFor = (dirPath) => {
    if (!dirPath) return null;
    if (folders.has(dirPath)) return folders.get(dirPath);
    const idx = dirPath.lastIndexOf("/");
    const parentId = folderFor(idx === -1 ? "" : dirPath.slice(0, idx));
    const id = newNodeId();
    folders.set(dirPath, id);
    out.push({ id, name: dirPath.slice(idx + 1), parentId, type: "folder" });
    return id;
  };
  for (const { path, content: body } of entries) {
    const idx = path.lastIndexOf("/");
    const parentId = folderFor(idx === -1 ? "" : path.slice(0, idx));
    out.push({ id: newNodeId(), name: path.slice(idx + 1), parentId, type: "file", content: body });
  }
  return out;
}
