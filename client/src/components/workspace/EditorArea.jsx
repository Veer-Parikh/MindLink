import { useMemo } from "react";
import { ChevronRight, Command, Eye, FilePlus2, History, Play, X } from "lucide-react";
import { modKey } from "../../lib/format.js";
import { Avatar, FileIcon, Kbd, LogoMark } from "../ui/index.jsx";
import { useWorkspace } from "./context.js";
import CodeEditor from "./CodeEditor.jsx";
import RewindView from "./RewindView.jsx";

function Tabs() {
  const { tabs, nodeById, activeFileId, openFile, closeTab, peers } = useWorkspace();
  const viewersByFile = useMemo(() => {
    const map = new Map();
    for (const p of peers) {
      if (!p.fileId) continue;
      const list = map.get(p.fileId) ?? [];
      if (!list.some((u) => u.id === p.user.id)) list.push(p.user);
      map.set(p.fileId, list);
    }
    return map;
  }, [peers]);

  if (tabs.length === 0) return <div className="tabs is-empty" />;
  return (
    <div className="tabs" role="tablist">
      {tabs.map((id) => {
        const node = nodeById.get(id);
        if (!node) return null;
        const viewers = viewersByFile.get(id) ?? [];
        return (
          <div
            key={id}
            role="tab"
            aria-selected={id === activeFileId}
            className={`tab ${id === activeFileId ? "is-active" : ""}`}
            onClick={() => openFile(id)}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                closeTab(id);
              }
            }}
            title={node.path}
          >
            <FileIcon name={node.name} size={15} />
            <span className="tab-name">{node.name}</span>
            {viewers.length > 0 && (
              <span className="tab-viewers">
                {viewers.slice(0, 3).map((u) => (
                  <span key={u.id} className="tree-dot" style={{ background: u.color }} />
                ))}
              </span>
            )}
            <button
              className="tab-close"
              aria-label={`Close ${node.name}`}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(id);
              }}
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function Breadcrumbs() {
  const { activeNode, peers, followedPeer, setFollowing } = useWorkspace();
  if (!activeNode) return null;
  const parts = activeNode.path.split("/");
  const here = peers.filter((p) => p.fileId === activeNode.id);
  const unique = Array.from(new Map(here.map((p) => [p.user.id, p.user])).values());
  return (
    <div className="breadcrumbs">
      <div className="crumbs">
        {parts.map((part, i) => (
          <span key={i} className={i === parts.length - 1 ? "crumb is-last" : "crumb"}>
            {i === parts.length - 1 && <FileIcon name={part} size={14} />}
            {part}
            {i < parts.length - 1 && <ChevronRight size={12} />}
          </span>
        ))}
      </div>
      <div className="crumb-right">
        {followedPeer && (
          <button className="follow-pill" style={{ "--c": followedPeer.user.color }} onClick={() => setFollowing(null)}>
            <Eye size={12} /> Following {followedPeer.user.name} <span className="muted">· Esc</span>
          </button>
        )}
        {unique.length > 0 && (
          <div
            className="here-now"
            data-tip={`${unique.map((u) => u.name).join(", ")} ${unique.length === 1 ? "is" : "are"} in this file`}
          >
            {unique.slice(0, 4).map((u) => (
              <Avatar key={u.id} user={u} size={20} title="" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyEditor() {
  const { canEdit, setPaletteMode, openSidebar, enterRewind, files, openFile } = useWorkspace();
  const recent = files.slice(0, 5);
  return (
    <div className="editor-empty">
      <div className="editor-empty-inner">
        <LogoMark size={56} />
        <h2>Pick a file to start</h2>
        <div className="editor-empty-actions">
          <button onClick={() => setPaletteMode("files")}>
            <Command size={15} /> Open file <Kbd>{modKey} P</Kbd>
          </button>
          {canEdit && (
            <button onClick={() => openSidebar("files")}>
              <FilePlus2 size={15} /> New file
            </button>
          )}
          <button onClick={() => enterRewind()}>
            <History size={15} /> Open Rewind <Kbd>Alt R</Kbd>
          </button>
          <button onClick={() => setPaletteMode("commands")}>
            <Play size={15} /> All commands <Kbd>{modKey} K</Kbd>
          </button>
        </div>
        {recent.length > 0 && (
          <div className="editor-empty-files">
            {recent.map((f) => (
              <button key={f.id} onClick={() => openFile(f.id)}>
                <FileIcon name={f.name} /> {f.path}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function EditorArea() {
  const { activeNode, rewind, followedPeer, role } = useWorkspace();
  if (rewind.active) return <RewindView />;
  return (
    <section className="editor-area" style={followedPeer ? { "--follow": followedPeer.user.color } : undefined}>
      <Tabs />
      <Breadcrumbs />
      <div className={`editor-body ${followedPeer ? "is-following" : ""}`}>
        {activeNode ? <CodeEditor /> : <EmptyEditor />}
        {role === "viewer" && activeNode && <div className="viewer-ribbon">Read-only</div>}
      </div>
    </section>
  );
}
