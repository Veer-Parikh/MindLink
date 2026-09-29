/**
 * Client-side view of a project's Y.Doc (see server/src/collab/model.js for the canonical shape).
 * Tree nodes are plain objects replaced wholesale on change; file bodies are Y.Text.
 */
import * as Y from "yjs";

export const treeOf = (doc) => doc.getMap("tree");
export const contentOf = (doc) => doc.getMap("content");

const randomId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

export function pathOf(tree, id) {
  const parts = [];
  let node = tree.get(id);
  let guard = 0;
  while (node && guard++ < 64) {
    parts.unshift(node.name);
    node = node.parentId ? tree.get(node.parentId) : null;
  }
  return parts.join("/");
}

/** Snapshot of the tree as nested nodes, folders first, alphabetical. */
export function buildTree(entries) {
  const byParent = new Map();
  for (const node of entries) {
    const key = node.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(node);
  }
  const sort = (list) =>
    list.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === "folder" ? -1 : 1,
    );
  const build = (parentId, depth, prefix) =>
    sort(byParent.get(parentId) ?? []).map((node) => {
      const path = prefix ? `${prefix}/${node.name}` : node.name;
      return { ...node, depth, path, children: node.type === "folder" ? build(node.id, depth + 1, path) : undefined };
    });
  return build(null, 0, "");
}

export function flattenFiles(nodes, out = []) {
  for (const n of nodes) {
    if (n.type === "file") out.push(n);
    else flattenFiles(n.children ?? [], out);
  }
  return out;
}

export function validateName(tree, name, parentId, ignoreId = null) {
  const clean = name.trim();
  if (!clean) return "Name can't be empty.";
  if (/[\\/:*?"<>|]/.test(clean)) return "Names can't contain / \\ : * ? \" < > |";
  if (clean === "." || clean === "..") return "That name is reserved.";
  if (clean.length > 120) return "That name is too long.";
  for (const [id, node] of tree) {
    if (id !== ignoreId && (node.parentId ?? null) === (parentId ?? null) && node.name.toLowerCase() === clean.toLowerCase()) {
      return `“${clean}” already exists here.`;
    }
  }
  return null;
}

export function createNode(doc, { name, parentId = null, type, content = "" }) {
  const id = randomId();
  doc.transact(() => {
    treeOf(doc).set(id, { id, name: name.trim(), parentId, type });
    if (type === "file") {
      const text = new Y.Text();
      contentOf(doc).set(id, text);
      if (content) text.insert(0, content);
    }
  });
  return id;
}

/** Creates a file at a slash path, creating folders on the way. Returns the file id. */
export function createAtPath(doc, path, content = "") {
  const tree = treeOf(doc);
  const parts = path.split("/").filter(Boolean);
  let parentId = null;
  for (let i = 0; i < parts.length - 1; i++) {
    let found = null;
    for (const [id, node] of tree) {
      if ((node.parentId ?? null) === parentId && node.name === parts[i] && node.type === "folder") found = id;
    }
    parentId = found ?? createNode(doc, { name: parts[i], parentId, type: "folder" });
  }
  return createNode(doc, { name: parts[parts.length - 1], parentId, type: "file", content });
}

export function renameNode(doc, id, name) {
  const node = treeOf(doc).get(id);
  if (node) treeOf(doc).set(id, { ...node, name: name.trim() });
}

export function isAncestor(tree, maybeAncestor, id) {
  let node = tree.get(id);
  let guard = 0;
  while (node && guard++ < 64) {
    if (node.parentId === maybeAncestor) return true;
    node = node.parentId ? tree.get(node.parentId) : null;
  }
  return false;
}

export function moveNode(doc, id, parentId) {
  const tree = treeOf(doc);
  const node = tree.get(id);
  if (!node || node.parentId === parentId || id === parentId) return false;
  if (parentId && isAncestor(tree, id, parentId)) return false;
  tree.set(id, { ...node, parentId });
  return true;
}

export function deleteNode(doc, id) {
  const tree = treeOf(doc);
  const content = contentOf(doc);
  const doomed = [id];
  for (let i = 0; i < doomed.length; i++) {
    for (const [childId, node] of tree) if (node.parentId === doomed[i]) doomed.push(childId);
  }
  doc.transact(() => {
    for (const d of doomed) {
      tree.delete(d);
      content.delete(d);
    }
  });
  return doomed;
}

export function exportFiles(doc) {
  const tree = treeOf(doc);
  const content = contentOf(doc);
  const out = [];
  tree.forEach((node, id) => {
    const entry = { ...node, id, path: pathOf(tree, id) };
    if (node.type === "file") entry.content = content.get(id)?.toString() ?? "";
    out.push(entry);
  });
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
