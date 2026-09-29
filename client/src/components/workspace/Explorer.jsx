import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { strToU8, zipSync } from "fflate";
import {
  ChevronRight,
  Copy,
  Download,
  FilePlus2,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  Pencil,
  Play,
  Trash2,
  ChevronsDownUp,
} from "lucide-react";
import { createNode, deleteNode, exportFiles, moveNode, renameNode, treeOf, validateName } from "../../collab/model.js";
import { FileIcon, Menu } from "../ui/index.jsx";
import { useWorkspace } from "./context.js";

function NameInput({ initial = "", onSubmit, onCancel, depth, kind }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState(null);
  const done = useRef(false);
  const submit = () => {
    if (done.current) return;
    if (!value.trim()) {
      done.current = true;
      onCancel();
      return;
    }
    const err = onSubmit(value);
    if (err) setError(err);
    else done.current = true;
  };
  return (
    <div className="tree-row is-editing" style={{ "--depth": depth }}>
      <span className="tree-chevron" />
      {kind === "folder" ? <FolderClosed className="tree-folder-icon" /> : <FileIcon name={value || "file.txt"} />}
      <div className="tree-input-wrap">
        <input
          className={`tree-input ${error ? "has-error" : ""}`}
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onFocus={(e) => {
            const dot = initial.lastIndexOf(".");
            e.target.setSelectionRange(0, dot > 0 ? dot : initial.length);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") {
              done.current = true;
              onCancel();
            }
          }}
          onBlur={submit}
          placeholder={kind === "folder" ? "folder name" : "file.js"}
        />
        {error && <div className="tree-input-error">{error}</div>}
      </div>
    </div>
  );
}

export function downloadZip(doc, projectName) {
  const files = exportFiles(doc).filter((f) => f.type === "file");
  const zipped = zipSync(Object.fromEntries(files.map((f) => [f.path, strToU8(f.content ?? "")])));
  const url = URL.createObjectURL(new Blob([zipped], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${projectName.replace(/[^\w-]+/g, "-").toLowerCase() || "project"}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Explorer() {
  const { doc, nodes, nodeById, activeFileId, openFile, canEdit, peers, project, run, openThreads } = useWorkspace();
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [creating, setCreating] = useState(null); // { parentId, kind }
  const [renaming, setRenaming] = useState(null);
  const [menu, setMenu] = useState(null);
  const [dropTarget, setDropTarget] = useState(undefined);
  const tree = treeOf(doc);

  const viewers = useMemo(() => {
    const map = new Map();
    for (const p of peers) {
      if (!p.fileId) continue;
      if (!map.has(p.fileId)) map.set(p.fileId, []);
      if (!map.get(p.fileId).some((u) => u.id === p.user.id)) map.get(p.fileId).push(p.user);
    }
    return map;
  }, [peers]);

  const threadCounts = useMemo(() => {
    const map = new Map();
    for (const t of openThreads) map.set(t.fileId, (map.get(t.fileId) ?? 0) + 1);
    return map;
  }, [openThreads]);

  const startCreate = (parentId, kind) => {
    if (parentId) setCollapsed((c) => new Set([...c].filter((id) => id !== parentId)));
    setCreating({ parentId, kind });
  };

  const create = (name) => {
    const err = validateName(tree, name, creating.parentId);
    if (err) return err;
    const id = createNode(doc, { name, parentId: creating.parentId, type: creating.kind });
    setCreating(null);
    if (creating.kind === "file") openFile(id);
    return null;
  };

  const rename = (node, name) => {
    const err = validateName(tree, name, node.parentId, node.id);
    if (err) return err;
    renameNode(doc, node.id, name);
    setRenaming(null);
    return null;
  };

  const remove = (node) => {
    const what = node.type === "folder" ? `the folder “${node.name}” and everything in it` : `“${node.name}”`;
    if (!window.confirm(`Delete ${what}? You can bring it back with Rewind.`)) return;
    deleteNode(doc, node.id);
    toast(`Deleted ${node.name}`, { description: "Everything is recoverable from Rewind." });
  };

  const onDrop = (e, parentId) => {
    e.preventDefault();
    setDropTarget(undefined);
    const id = e.dataTransfer.getData("application/x-mindlink-node");
    if (!id || !canEdit) return;
    const node = nodeById.get(id);
    if (!node) return;
    const clash = validateName(tree, node.name, parentId, id);
    if (clash) {
      toast.error(clash);
      return;
    }
    if (!moveNode(doc, id, parentId)) return;
    if (parentId) setCollapsed((c) => new Set([...c].filter((x) => x !== parentId)));
  };

  const openMenu = (e, node) => {
    e.preventDefault();
    e.stopPropagation();
    const parentForNew = node ? (node.type === "folder" ? node.id : node.parentId) : null;
    setMenu({
      at: { x: e.clientX, y: e.clientY },
      items: [
        node?.type === "file" && { label: "Run", icon: Play, onClick: () => run(node.id) },
        canEdit && { label: "New file", icon: FilePlus2, onClick: () => startCreate(parentForNew, "file") },
        canEdit && { label: "New folder", icon: FolderPlus, onClick: () => startCreate(parentForNew, "folder") },
        node && canEdit && "sep",
        node && canEdit && { label: "Rename", icon: Pencil, kbd: "F2", onClick: () => setRenaming(node.id) },
        node && { label: "Copy path", icon: Copy, onClick: () => navigator.clipboard?.writeText(node.path) },
        node && canEdit && "sep",
        node && canEdit && { label: "Delete", icon: Trash2, danger: true, onClick: () => remove(node) },
      ].filter(Boolean),
    });
  };

  const renderNodes = (list, depth, parentId) => (
    <>
      {creating && creating.parentId === parentId && (
        <NameInput depth={depth} kind={creating.kind} onSubmit={create} onCancel={() => setCreating(null)} />
      )}
      {list.map((node) => {
        if (renaming === node.id) {
          return (
            <div key={node.id}>
              <NameInput
                depth={depth}
                kind={node.type}
                initial={node.name}
                onSubmit={(name) => rename(node, name)}
                onCancel={() => setRenaming(null)}
              />
              {node.type === "folder" && !collapsed.has(node.id) && renderNodes(node.children, depth + 1, node.id)}
            </div>
          );
        }
        const isFolder = node.type === "folder";
        const open = isFolder && !collapsed.has(node.id);
        const here = viewers.get(node.id) ?? [];
        const threads = threadCounts.get(node.id);
        return (
          <div key={node.id}>
            <div
              className={`tree-row ${activeFileId === node.id ? "is-active" : ""} ${dropTarget === node.id ? "is-drop" : ""}`}
              style={{ "--depth": depth }}
              role="treeitem"
              aria-expanded={isFolder ? open : undefined}
              tabIndex={0}
              draggable={canEdit}
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-mindlink-node", node.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (!isFolder || !canEdit) return;
                e.preventDefault();
                e.stopPropagation();
                setDropTarget(node.id);
              }}
              onDragLeave={() => setDropTarget((t) => (t === node.id ? undefined : t))}
              onDrop={(e) => {
                if (!isFolder) return;
                e.stopPropagation();
                onDrop(e, node.id);
              }}
              onClick={() => {
                if (isFolder)
                  setCollapsed((c) => {
                    const next = new Set(c);
                    if (next.has(node.id)) next.delete(node.id);
                    else next.add(node.id);
                    return next;
                  });
                else openFile(node.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "F2" && canEdit) setRenaming(node.id);
                if (e.key === "Delete" && canEdit) remove(node);
                if (e.key === "Enter" && !isFolder) openFile(node.id);
              }}
              onContextMenu={(e) => openMenu(e, node)}
            >
              <span className={`tree-chevron ${open ? "is-open" : ""}`}>{isFolder && <ChevronRight size={14} />}</span>
              {isFolder ? (
                open ? (
                  <FolderOpen className="tree-folder-icon" />
                ) : (
                  <FolderClosed className="tree-folder-icon" />
                )
              ) : (
                <FileIcon name={node.name} />
              )}
              <span className="tree-name">{node.name}</span>
              {threads > 0 && (
                <span className="tree-threads" data-tip={`${threads} open thread${threads > 1 ? "s" : ""}`}>
                  {threads}
                </span>
              )}
              {here.length > 0 && (
                <span className="tree-presence">
                  {here.slice(0, 3).map((u) => (
                    <span key={u.id} className="tree-dot" style={{ background: u.color }} data-tip={`${u.name} is here`} />
                  ))}
                </span>
              )}
            </div>
            {open && <div role="group">{renderNodes(node.children, depth + 1, node.id)}</div>}
          </div>
        );
      })}
    </>
  );

  return (
    <div className="explorer">
      <div className="panel-header">
        <span className="panel-title">Explorer</span>
        <div className="panel-actions">
          {canEdit && (
            <>
              <button className="icon-btn sm" onClick={() => startCreate(null, "file")} data-tip="New file">
                <FilePlus2 />
              </button>
              <button className="icon-btn sm" onClick={() => startCreate(null, "folder")} data-tip="New folder">
                <FolderPlus />
              </button>
            </>
          )}
          <button
            className="icon-btn sm"
            onClick={() =>
              setCollapsed(
                new Set(
                  Array.from(nodeById.values())
                    .filter((n) => n.type === "folder")
                    .map((n) => n.id),
                ),
              )
            }
            data-tip="Collapse folders"
          >
            <ChevronsDownUp />
          </button>
          <button className="icon-btn sm" onClick={() => downloadZip(doc, project.name)} data-tip="Download as .zip">
            <Download />
          </button>
        </div>
      </div>
      <div
        className={`tree ${dropTarget === null ? "is-drop-root" : ""}`}
        role="tree"
        onContextMenu={(e) => openMenu(e, null)}
        onDragOver={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          setDropTarget(null);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDropTarget(undefined);
        }}
        onDrop={(e) => onDrop(e, null)}
      >
        {renderNodes(nodes, 0, null)}
        {nodes.length === 0 && !creating && (
          <div className="tree-empty">
            <p>No files yet.</p>
            {canEdit && (
              <button className="btn btn-sm" onClick={() => startCreate(null, "file")}>
                <FilePlus2 /> Create a file
              </button>
            )}
          </div>
        )}
      </div>
      <Menu open={Boolean(menu)} at={menu?.at} items={menu?.items ?? []} onClose={() => setMenu(null)} />
    </div>
  );
}
