import * as Y from "yjs";
import { api } from "../lib/api.js";

/** Current 1-based line of a thread: follows its CRDT anchor as code moves, falls back to the stored line. */
export function threadLine(doc, thread) {
  if (!thread.anchor) return thread.line;
  try {
    const abs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(thread.anchor), doc);
    if (!abs) return thread.line;
    const text = abs.type.toString();
    let line = 1;
    for (let i = 0; i < abs.index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
    return line;
  } catch {
    return thread.line;
  }
}

/** Anchor for the start of `line` in a file's Y.Text. */
export function anchorForLine(ytext, line) {
  const text = ytext.toString();
  let index = 0;
  for (let l = 1; l < line; l++) {
    const next = text.indexOf("\n", index);
    if (next === -1) break;
    index = next + 1;
  }
  return Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, index));
}

export const threadApi = (projectId) => ({
  create: (body) => api(`/projects/${projectId}/threads`, { method: "POST", body }),
  reply: (id, text) => api(`/projects/${projectId}/threads/${id}/comments`, { method: "POST", body: { text } }),
  resolve: (id, resolved) => api(`/projects/${projectId}/threads/${id}`, { method: "PATCH", body: { resolved } }),
  remove: (id) => api(`/projects/${projectId}/threads/${id}`, { method: "DELETE" }),
});
