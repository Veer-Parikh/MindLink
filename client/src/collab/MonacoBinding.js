/**
 * Binds one Y.Text to one Monaco model/editor pair.
 *
 * Compared to the stock y-monaco binding this one:
 *  - renders remote cursors with name labels in each person's colour,
 *  - keeps a per-user undo stack (Ctrl+Z never undoes a teammate's work),
 *  - publishes the local selection as Yjs relative positions tagged with the file id,
 *  - disposes every listener it registers (the editor instance is reused across files).
 */
import * as Y from "yjs";
import * as monaco from "monaco-editor";

const peerStyleEl = (() => {
  if (typeof document === "undefined") return null;
  const el = document.createElement("style");
  el.id = "ml-peer-styles";
  document.head.appendChild(el);
  return el;
})();
const styledPeers = new Map();
const LABEL_MS = 2500;

function cssEscape(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");
}

/** Injects per-client CSS rules for cursor colour + label once per (clientId, name, colour). */
export function ensurePeerStyle(clientId, name, color) {
  const key = `${name}|${color}`;
  if (styledPeers.get(clientId) === key || !peerStyleEl) return;
  styledPeers.set(clientId, key);
  const rules = Array.from(styledPeers.entries())
    .map(([id, value]) => {
      const [n, c] = value.split("|");
      return `
.ml-sel-${id} { background-color: ${c}33; }
.ml-caret-${id} { border-color: ${c}; }
.ml-caret-${id}::after { content: "${cssEscape(n)}"; background: ${c}; }
.ml-line-${id} { background: ${c}12; }`;
    })
    .join("\n");
  peerStyleEl.textContent = rules;
}

export class MonacoBinding {
  constructor({ ytext, editor, awareness, fileId, onLocalChange }) {
    this.ytext = ytext;
    this.doc = ytext.doc;
    this.editor = editor;
    this.model = editor.getModel();
    this.awareness = awareness;
    this.fileId = fileId;
    this.muted = false;
    this.disposables = [];
    this.decorations = editor.createDecorationsCollection([]);
    this.savedSelection = null;
    this.peerActivity = new Map(); // clientId → { key, at } — labels show briefly after someone moves
    this.labelTimer = 0;

    this.undoManager = new Y.UndoManager(ytext, { trackedOrigins: new Set([this]), captureTimeout: 400 });

    // Initial content.
    const initial = ytext.toString();
    if (this.model.getValue() !== initial) this.withMute(() => this.model.setValue(initial));

    // Remember where our cursor was (as a CRDT position) before any transaction so remote edits don't jump it.
    this.beforeTx = () => {
      if (this.muted) return;
      const sel = editor.getSelection();
      if (!sel || editor.getModel() !== this.model) {
        this.savedSelection = null;
        return;
      }
      this.savedSelection = {
        start: Y.createRelativePositionFromTypeIndex(ytext, this.model.getOffsetAt(sel.getStartPosition())),
        end: Y.createRelativePositionFromTypeIndex(ytext, this.model.getOffsetAt(sel.getEndPosition())),
        direction: sel.getDirection(),
      };
    };
    this.doc.on("beforeAllTransactions", this.beforeTx);

    // Y.Text → Monaco
    this.observer = (event, tx) => {
      if (tx.origin === this) return;
      this.withMute(() => {
        this.applyDeltaSequentially(event.delta);
        this.restoreSelection();
      });
      this.renderPeers();
    };
    ytext.observe(this.observer);

    // Monaco → Y.Text
    this.disposables.push(
      this.model.onDidChangeContent((e) => {
        if (this.muted) return;
        this.doc.transact(() => {
          const changes = [...e.changes].sort((a, b) => b.rangeOffset - a.rangeOffset);
          for (const c of changes) {
            if (c.rangeLength) ytext.delete(c.rangeOffset, c.rangeLength);
            if (c.text) ytext.insert(c.rangeOffset, c.text);
          }
        }, this);
        onLocalChange?.();
      }),
    );

    // Local cursor → awareness
    this.publishCursor = () => {
      const sel = editor.getSelection();
      if (!sel || editor.getModel() !== this.model) return;
      let anchor = this.model.getOffsetAt(sel.getStartPosition());
      let head = this.model.getOffsetAt(sel.getEndPosition());
      if (sel.getDirection() === monaco.SelectionDirection.RTL) [anchor, head] = [head, anchor];
      const current = awareness.getLocalState() ?? {};
      awareness.setLocalState({
        ...current,
        fileId,
        cursor: {
          fileId,
          anchor: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, anchor)),
          head: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, head)),
          line: sel.positionLineNumber,
        },
      });
    };
    this.disposables.push(editor.onDidChangeCursorSelection(this.publishCursor));
    this.publishCursor();

    this.awarenessHandler = () => this.renderPeers();
    awareness.on("change", this.awarenessHandler);
    this.renderPeers();
  }

  withMute(fn) {
    this.muted = true;
    try {
      fn();
    } finally {
      this.muted = false;
    }
  }

  applyDeltaSequentially(delta) {
    let index = 0;
    for (const op of delta) {
      if (op.retain !== undefined) {
        index += op.retain;
      } else if (op.insert !== undefined) {
        const pos = this.model.getPositionAt(index);
        this.model.applyEdits([
          { range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column), text: op.insert },
        ]);
        index += op.insert.length;
      } else if (op.delete !== undefined) {
        const start = this.model.getPositionAt(index);
        const end = this.model.getPositionAt(index + op.delete);
        this.model.applyEdits([
          { range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column), text: "" },
        ]);
      }
    }
  }

  restoreSelection() {
    const saved = this.savedSelection;
    if (!saved || this.editor.getModel() !== this.model) return;
    const start = Y.createAbsolutePositionFromRelativePosition(saved.start, this.doc);
    const end = Y.createAbsolutePositionFromRelativePosition(saved.end, this.doc);
    if (!start || !end || start.type !== this.ytext || end.type !== this.ytext) return;
    const s = this.model.getPositionAt(start.index);
    const e = this.model.getPositionAt(end.index);
    this.editor.setSelection(
      monaco.Selection.createWithDirection(s.lineNumber, s.column, e.lineNumber, e.column, saved.direction),
    );
  }

  renderPeers() {
    if (this.editor.getModel() !== this.model) return;
    const decorations = [];
    const now = Date.now();
    let nextExpiry = Infinity;
    this.awareness.getStates().forEach((state, clientId) => {
      if (clientId === this.doc.clientID || !state?.cursor || state.cursor.fileId !== this.fileId || !state.user) return;
      let anchor;
      let head;
      try {
        anchor = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(state.cursor.anchor), this.doc);
        head = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(state.cursor.head), this.doc);
      } catch {
        return;
      }
      if (!anchor || !head || anchor.type !== this.ytext || head.type !== this.ytext) return;
      ensurePeerStyle(clientId, state.user.name, state.user.color);
      const key = `${head.index}:${anchor.index}`;
      const activity = this.peerActivity.get(clientId);
      if (!activity || activity.key !== key) this.peerActivity.set(clientId, { key, at: activity ? now : now - 1000 });
      const age = now - this.peerActivity.get(clientId).at;
      const labeled = age < LABEL_MS;
      if (labeled) nextExpiry = Math.min(nextExpiry, LABEL_MS - age);
      const headPos = this.model.getPositionAt(head.index);
      const [from, to] = anchor.index < head.index ? [anchor.index, head.index] : [head.index, anchor.index];
      if (from !== to) {
        const s = this.model.getPositionAt(from);
        const e = this.model.getPositionAt(to);
        decorations.push({
          range: new monaco.Range(s.lineNumber, s.column, e.lineNumber, e.column),
          options: { className: `ml-sel ml-sel-${clientId}`, stickiness: 1 },
        });
      }
      decorations.push({
        range: new monaco.Range(headPos.lineNumber, headPos.column, headPos.lineNumber, headPos.column),
        options: {
          beforeContentClassName: `ml-caret ml-caret-${clientId}${labeled ? " ml-caret-labeled" : ""}${headPos.lineNumber === 1 ? " ml-caret-below" : ""}`,
          stickiness: 1,
        },
      });
      decorations.push({
        range: new monaco.Range(headPos.lineNumber, 1, headPos.lineNumber, 1),
        options: { isWholeLine: true, className: `ml-line-${clientId}` },
      });
    });
    this.decorations.set(decorations);
    clearTimeout(this.labelTimer);
    if (nextExpiry !== Infinity) this.labelTimer = setTimeout(() => this.renderPeers(), nextExpiry + 30);
  }

  undo() {
    this.undoManager.undo();
  }

  redo() {
    this.undoManager.redo();
  }

  destroy() {
    // Both the editor's teardown and the file-swap effect may call this when the editor unmounts.
    if (this.destroyed) return;
    this.destroyed = true;
    this.doc.off("beforeAllTransactions", this.beforeTx);
    this.ytext.unobserve(this.observer);
    this.awareness.off("change", this.awarenessHandler);
    this.disposables.forEach((d) => d.dispose());
    clearTimeout(this.labelTimer);
    this.decorations.clear();
    this.undoManager.destroy();
  }
}
