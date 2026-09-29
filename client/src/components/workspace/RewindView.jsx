import { useEffect, useMemo, useRef } from "react";
import { diffLines } from "diff";
import { ChevronRight, FileMinus2, FolderClosed, History } from "lucide-react";
import { buildTree, exportFiles } from "../../collab/model.js";
import { languageFor } from "../../lib/languages.js";
import { EmptyState, FileIcon, Spinner } from "../ui/index.jsx";
import { EDITOR_OPTIONS, monaco, setupMonaco } from "./monaco.js";
import { useWorkspace } from "./context.js";

setupMonaco();

/** Per-file status between two snapshots: "added" | "modified" | undefined, plus removed files. */
function fileChanges(prevFiles, nextFiles) {
  const prev = new Map((prevFiles ?? []).filter((f) => f.type === "file").map((f) => [f.id, f]));
  const status = new Map();
  for (const f of nextFiles ?? []) {
    if (f.type !== "file") continue;
    const before = prev.get(f.id);
    prev.delete(f.id);
    if (!before) status.set(f.id, prevFiles ? "added" : undefined);
    else if (before.content !== f.content) status.set(f.id, "modified");
    else if (before.path !== f.path) status.set(f.id, "moved");
  }
  return { status, removed: prevFiles ? Array.from(prev.values()) : [] };
}

/** 1-based line numbers that are new in `next`, and lines after which something was deleted. */
function lineChanges(prev, next) {
  const added = [];
  const removedAt = [];
  let line = 1;
  for (const part of diffLines(prev ?? "", next ?? "")) {
    const count = part.count ?? part.value.split("\n").length - (part.value.endsWith("\n") ? 1 : 0);
    if (part.added) {
      for (let i = 0; i < count; i++) added.push(line + i);
      line += count;
    } else if (part.removed) {
      removedAt.push(Math.max(1, line));
    } else {
      line += count;
    }
  }
  return { added, removedAt };
}

function useSnapshotFile() {
  const { rewind, rewindFileId, setRewindFileId } = useWorkspace();
  const snap = rewind.currentFull;
  const prev = rewind.previousFull;
  const changes = useMemo(() => fileChanges(prev?.files, snap?.files), [prev, snap]);

  // If the chosen file doesn't exist at this moment, fall back to something that changed (or anything).
  const files = snap?.files.filter((f) => f.type === "file") ?? [];
  let file = files.find((f) => f.id === rewindFileId);
  if (!file && snap) file = files.find((f) => changes.status.get(f.id)) ?? files[0];
  useEffect(() => {
    if (file && file.id !== rewindFileId && !files.some((f) => f.id === rewindFileId)) setRewindFileId(file.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id]);

  const prevFile = prev?.files.find((f) => f.id === file?.id);
  return { snap, prev, file, prevFile, changes };
}

export function RewindExplorer() {
  const { rewindFileId, setRewindFileId } = useWorkspace();
  const { snap, file, changes } = useSnapshotFile();
  const nodes = useMemo(() => (snap ? buildTree(snap.files) : []), [snap]);

  const render = (list, depth) =>
    list.map((n) =>
      n.type === "folder" ? (
        <div key={n.id}>
          <div className="tree-row is-static" style={{ "--depth": depth }}>
            <span className="tree-chevron is-open">
              <ChevronRight size={14} />
            </span>
            <FolderClosed className="tree-folder-icon" />
            <span className="tree-name">{n.name}</span>
          </div>
          {render(n.children, depth + 1)}
        </div>
      ) : (
        <div
          key={n.id}
          className={`tree-row ${(file?.id ?? rewindFileId) === n.id ? "is-active" : ""}`}
          style={{ "--depth": depth }}
          onClick={() => setRewindFileId(n.id)}
        >
          <span className="tree-chevron" />
          <FileIcon name={n.name} />
          <span className="tree-name">{n.name}</span>
          {changes.status.get(n.id) && (
            <span className={`change-tag is-${changes.status.get(n.id)}`}>{changes.status.get(n.id)[0].toUpperCase()}</span>
          )}
        </div>
      ),
    );

  return (
    <div className="explorer">
      <div className="panel-header">
        <span className="panel-title rewind-title">
          <History size={13} /> Files at this moment
        </span>
      </div>
      <div className="tree">
        {!snap ? (
          <div className="panel-loading">
            <Spinner />
          </div>
        ) : (
          <>
            {render(nodes, 0)}
            {changes.removed.length > 0 && (
              <div className="rewind-removed">
                <span>Removed in this step</span>
                {changes.removed.map((f) => (
                  <div key={f.id} className="tree-row is-static is-removed" style={{ "--depth": 0 }}>
                    <span className="tree-chevron" />
                    <FileMinus2 size={14} />
                    <span className="tree-name">{f.path}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function RewindView() {
  const { rewind, doc } = useWorkspace();
  const { snap, file, prevFile } = useSnapshotFile();
  const host = useRef(null);
  const editorRef = useRef(null);
  const diffRef = useRef(null);
  const decorations = useRef(null);
  const compare = rewind.compare;

  // Single read-only editor, or a diff editor comparing then vs now.
  useEffect(() => {
    if (!host.current) return undefined;
    if (compare) {
      const diff = monaco.editor.createDiffEditor(host.current, {
        ...EDITOR_OPTIONS,
        readOnly: true,
        originalEditable: false,
        renderSideBySide: host.current.clientWidth > 900,
        minimap: { enabled: false },
        glyphMargin: false,
      });
      diffRef.current = diff;
      return () => {
        const model = diff.getModel();
        diff.dispose();
        model?.original.dispose();
        model?.modified.dispose();
        diffRef.current = null;
      };
    }
    const editor = monaco.editor.create(host.current, { ...EDITOR_OPTIONS, readOnly: true, domReadOnly: true, model: null });
    const model = monaco.editor.createModel("", "plaintext");
    editor.setModel(model);
    editorRef.current = editor;
    decorations.current = editor.createDecorationsCollection([]);
    return () => {
      editor.dispose();
      model.dispose();
      editorRef.current = null;
    };
  }, [compare]);

  // Show the snapshot's version of the file and highlight what this step changed.
  const content = file?.content ?? null;
  const prevContent = prevFile?.content ?? (rewind.previousFull ? "" : null);
  const language = file ? languageFor(file.name).id : "plaintext";
  useEffect(() => {
    if (compare) {
      const diff = diffRef.current;
      if (!diff || content == null) return;
      const live = exportFiles(doc).find((f) => f.id === file.id)?.content ?? "";
      const old = diff.getModel();
      diff.setModel({
        original: monaco.editor.createModel(content, language),
        modified: monaco.editor.createModel(live, language),
      });
      old?.original.dispose();
      old?.modified.dispose();
      return;
    }
    const editor = editorRef.current;
    if (!editor || content == null) return;
    const model = editor.getModel();
    const scrollTop = editor.getScrollTop();
    monaco.editor.setModelLanguage(model, language);
    if (model.getValue() !== content) model.setValue(content);
    editor.setScrollTop(scrollTop);

    const { added, removedAt } = prevContent == null ? { added: [], removedAt: [] } : lineChanges(prevContent, content);
    decorations.current.set([
      ...added.map((line) => ({
        range: new monaco.Range(line, 1, line, 1),
        options: { isWholeLine: true, className: "ml-rw-added", linesDecorationsClassName: "ml-rw-added-bar" },
      })),
      ...removedAt.map((line) => ({
        range: new monaco.Range(line, 1, line, 1),
        options: { linesDecorationsClassName: "ml-rw-removed-bar" },
      })),
    ]);
    // During playback, follow the action.
    if (rewind.playing && added.length) editor.revealLineInCenterIfOutsideViewport(added[0], monaco.editor.ScrollType.Smooth);
  }, [content, prevContent, language, compare, rewind.playing, doc, file?.id]);

  return (
    <section className="editor-area rewind-area">
      <div className="rewind-banner">
        <History size={14} />
        {file ? (
          <>
            <FileIcon name={file.name} size={14} />
            <span className="rewind-path">{file.path}</span>
            <span className="muted">{compare ? "· then (left) vs now (right)" : "· read-only snapshot"}</span>
          </>
        ) : (
          <span>Rewind</span>
        )}
      </div>
      <div className="editor-body">
        {!snap && (
          <div className="rewind-loading">
            <Spinner /> Loading snapshot…
          </div>
        )}
        {snap && !file && (
          <EmptyState icon={History} title="No files at this moment">
            The project was empty here.
          </EmptyState>
        )}
        <div ref={host} className="code-editor" style={{ visibility: snap && file ? "visible" : "hidden" }} />
      </div>
    </section>
  );
}
