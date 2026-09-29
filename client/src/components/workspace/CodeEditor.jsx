import { useEffect, useRef } from "react";
import * as Y from "yjs";
import { MonacoBinding } from "../../collab/MonacoBinding.js";
import { anchorForLine, threadLine } from "../../collab/threads.js";
import { useYVersion } from "../../collab/room.js";
import { languageFor } from "../../lib/languages.js";
import { EDITOR_OPTIONS, monaco, setupMonaco } from "./monaco.js";
import { useWorkspace } from "./context.js";

setupMonaco();

/** Broadcasts caret position to the status bar without re-rendering the workspace. */
export const cursorBus = new EventTarget();

export default function CodeEditor() {
  const ws = useWorkspace();
  const { activeNode, contentOf, room, canEdit, reveal, followedPeer, openThreads, editorApi, doc } = ws;
  const container = useRef(null);
  const editorRef = useRef(null);
  const models = useRef(new Map()); // fileId → { model, path }
  const viewStates = useRef(new Map());
  const bindingRef = useRef(null);
  const threadDecorations = useRef(null);
  const latest = useRef(ws);
  latest.current = ws;

  // Create the editor once.
  useEffect(() => {
    const editor = monaco.editor.create(container.current, { ...EDITOR_OPTIONS, model: null, readOnly: true });
    editorRef.current = editor;
    threadDecorations.current = editor.createDecorationsCollection([]);

    // Per-user undo/redo through Yjs instead of Monaco's model-wide stack.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ, () => bindingRef.current?.undo());
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ, () => bindingRef.current?.redo());
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, () => bindingRef.current?.redo());

    editor.addAction({
      id: "mindlink.comment",
      label: "Comment on line",
      contextMenuGroupId: "0_mindlink",
      contextMenuOrder: 1,
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyM],
      run: (ed) => {
        const { activeNode: node, contentOf: contents } = latest.current;
        const ytext = node && contents.get(node.id);
        const pos = ed.getPosition();
        if (!ytext || !pos) return;
        const sel = ed.getSelection();
        const model = ed.getModel();
        const quote = sel && !sel.isEmpty() ? model.getValueInRange(sel) : model.getLineContent(pos.lineNumber);
        latest.current.setThreadDraft({
          fileId: node.id,
          line: sel && !sel.isEmpty() ? sel.startLineNumber : pos.lineNumber,
          anchor: anchorForLine(ytext, sel && !sel.isEmpty() ? sel.startLineNumber : pos.lineNumber),
          quote: quote.trim().slice(0, 200),
        });
        latest.current.openSidebar("threads");
      },
    });
    editor.addAction({
      id: "mindlink.askPair",
      label: "Ask Pair about this",
      contextMenuGroupId: "0_mindlink",
      contextMenuOrder: 2,
      run: () => latest.current.openSidebar("pair"),
    });

    editor.onMouseDown((e) => {
      if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
        const line = e.target.position?.lineNumber;
        const { openThreads: threads, activeNode: node, doc: d } = latest.current;
        const hit = threads.find((t) => t.fileId === node?.id && threadLine(d, t) === line);
        if (hit) {
          latest.current.setFocusThread(hit.id);
          latest.current.openSidebar("threads");
        }
      } else if (latest.current.following) {
        latest.current.setFollowing(null);
      }
    });
    editor.onKeyDown(() => {
      if (latest.current.following) latest.current.setFollowing(null);
    });
    editor.onDidChangeCursorPosition((e) => {
      cursorBus.dispatchEvent(new CustomEvent("cursor", { detail: { line: e.position.lineNumber, col: e.position.column } }));
    });

    editorApi.current = {
      getSelectionText: () => {
        const sel = editor.getSelection();
        return sel && !sel.isEmpty() ? (editor.getModel()?.getValueInRange(sel) ?? "") : "";
      },
      insertText: (text) => {
        const sel = editor.getSelection();
        if (!sel || editor.getOption(monaco.editor.EditorOption.readOnly)) return;
        editor.executeEdits("pair", [{ range: sel, text, forceMoveMarkers: true }]);
        editor.focus();
      },
      focus: () => editor.focus(),
    };

    const modelMap = models.current;
    return () => {
      bindingRef.current?.destroy();
      bindingRef.current = null;
      editorApi.current = null;
      editor.dispose();
      modelMap.forEach(({ model }) => model.dispose());
      modelMap.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap the bound file when the active tab changes (or the file is renamed).
  const fileId = activeNode?.id;
  const filePath = activeNode?.path;
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !fileId) return undefined;
    const ytext = contentOf.get(fileId);
    if (!(ytext instanceof Y.Text)) return undefined;

    let entry = models.current.get(fileId);
    if (entry && entry.path !== filePath) {
      entry.model.dispose();
      models.current.delete(fileId);
      entry = null;
    }
    if (!entry) {
      const uri = monaco.Uri.parse(`file:///${filePath.split("/").map(encodeURIComponent).join("/")}`);
      monaco.editor.getModel(uri)?.dispose();
      const model = monaco.editor.createModel(ytext.toString(), languageFor(filePath.split("/").pop()).id, uri);
      entry = { model, path: filePath };
      models.current.set(fileId, entry);
    }
    editor.setModel(entry.model);
    const saved = viewStates.current.get(fileId);
    if (saved) editor.restoreViewState(saved);
    const binding = new MonacoBinding({ ytext, editor, awareness: room.awareness, fileId });
    bindingRef.current = binding;
    if (!latest.current.following) editor.focus();

    return () => {
      viewStates.current.set(fileId, editor.saveViewState());
      binding.destroy();
      if (bindingRef.current === binding) bindingRef.current = null;
    };
  }, [fileId, filePath, contentOf, room]);

  // Drop cached models for files that no longer exist.
  useEffect(() => {
    for (const [id, { model }] of models.current) {
      if (!ws.nodeById.has(id)) {
        model.dispose();
        models.current.delete(id);
        viewStates.current.delete(id);
      }
    }
  }, [ws.nodeById]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly: !canEdit, domReadOnly: !canEdit });
  }, [canEdit, fileId]);

  // Jump to a requested line.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !reveal || reveal.fileId !== fileId) return;
    const id = requestAnimationFrame(() => {
      editor.revealLineInCenter(reveal.line, monaco.editor.ScrollType.Smooth);
      editor.setPosition({ lineNumber: reveal.line, column: 1 });
      editor.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [reveal, fileId]);

  // Follow mode: keep the followed person's caret in view.
  const followCursor = followedPeer?.cursor;
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !followCursor || followCursor.fileId !== fileId) return;
    try {
      const head = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(followCursor.head), doc);
      if (!head) return;
      const pos = editor.getModel()?.getPositionAt(head.index);
      if (pos) editor.revealPositionInCenterIfOutsideViewport(pos, monaco.editor.ScrollType.Smooth);
    } catch {
      /* stale position */
    }
  }, [followCursor, fileId, doc]);

  // Thread markers in the gutter (re-evaluated as code moves).
  const contentVersion = useYVersion(fileId ? contentOf.get(fileId) : null);
  useEffect(() => {
    const collection = threadDecorations.current;
    if (!collection || !fileId) return;
    const decorations = openThreads
      .filter((t) => t.fileId === fileId)
      .map((t) => {
        const line = threadLine(doc, t);
        const first = t.comments[0];
        return {
          range: new monaco.Range(line, 1, line, 1),
          options: {
            isWholeLine: true,
            className: "ml-thread-line",
            glyphMarginClassName: "ml-thread-glyph",
            glyphMarginHoverMessage: {
              value: `**${first?.name ?? "Someone"}:** ${first?.text ?? ""}${t.comments.length > 1 ? `\n\n_+${t.comments.length - 1} repl${t.comments.length > 2 ? "ies" : "y"}_` : ""}`,
            },
          },
        };
      });
    collection.set(decorations);
  }, [openThreads, fileId, doc, contentVersion]);

  return <div ref={container} className="code-editor" />;
}
