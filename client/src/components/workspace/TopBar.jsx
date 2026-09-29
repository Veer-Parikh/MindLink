import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Bookmark, ChevronLeft, Eye, History, Play, Search, Share2, Square } from "lucide-react";
import { api } from "../../lib/api.js";
import { modKey } from "../../lib/format.js";
import { runInfo } from "../../runners/index.js";
import { uniquePeople } from "../../collab/room.js";
import { Avatar, LogoMark } from "../ui/index.jsx";
import { useWorkspace } from "./context.js";

function ProjectName() {
  const { project, setProject, canEdit } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(project.name);
  const input = useRef(null);

  useEffect(() => {
    if (!editing) setValue(project.name);
  }, [project.name, editing]);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  async function save() {
    setEditing(false);
    const name = value.trim();
    if (!name || name === project.name) return;
    try {
      const { project: updated } = await api(`/projects/${project.id}`, { method: "PATCH", body: { name } });
      setProject((p) => ({ ...p, name: updated.name }));
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (editing) {
    return (
      <input
        ref={input}
        className="input input-sm tb-name-input"
        value={value}
        maxLength={60}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }
  return (
    <button className="tb-name" onClick={() => canEdit && setEditing(true)} data-tip={canEdit ? "Rename project" : undefined}>
      {project.name}
    </button>
  );
}

export default function TopBar() {
  const {
    role,
    peers,
    following,
    setFollowing,
    activeNode,
    run,
    stop,
    runState,
    meta,
    setModal,
    canEdit,
    rewind,
    enterRewind,
    setPaletteMode,
  } = useWorkspace();
  const people = uniquePeople(peers);
  const info = activeNode ? runInfo(activeNode.name, meta) : null;
  const running = runState.status === "running";

  return (
    <header className="topbar">
      <div className="tb-left">
        <Link to="/app" className="tb-home" data-tip="All projects">
          <ChevronLeft size={16} />
          <LogoMark size={24} />
        </Link>
        <span className="tb-sep">/</span>
        <ProjectName />
        {role === "viewer" && (
          <span className="badge badge-warning" data-tip="You can chat, comment and run code, but not edit">
            <Eye /> View only
          </span>
        )}
      </div>

      <button className="tb-search" onClick={() => setPaletteMode("commands")}>
        <Search size={14} />
        <span>Search files & commands</span>
        <kbd className="kbd">{modKey} K</kbd>
      </button>

      <div className="tb-right">
        {people.length > 0 && (
          <div className="tb-presence">
            {people.slice(0, 5).map((p) => {
              const isFollowed = following === p.user.id;
              return (
                <button
                  key={p.user.id}
                  className={`tb-peer ${isFollowed ? "is-following" : ""}`}
                  onClick={() => setFollowing(isFollowed ? null : p.user.id)}
                  data-tip={isFollowed ? `Following ${p.user.name} — click to stop` : `Follow ${p.user.name}`}
                >
                  <Avatar user={p.user} size={28} online ring={isFollowed ? p.user.color : undefined} title="" />
                </button>
              );
            })}
            {people.length > 5 && <span className="avatar-more">+{people.length - 5}</span>}
          </div>
        )}

        <button
          className={`btn btn-sm ${rewind.active ? "btn-rewind-active" : ""}`}
          onClick={() => (rewind.active ? rewind.exit() : enterRewind())}
          data-tip="Scrub through every change (Alt+R)"
        >
          <History /> Rewind
        </button>
        {canEdit && (
          <button className="btn btn-sm" onClick={() => setModal("checkpoint")} data-tip={`Name this moment (${modKey}+Shift+S)`}>
            <Bookmark /> Checkpoint
          </button>
        )}
        {running ? (
          <button className="btn btn-sm btn-danger" onClick={stop}>
            <Square /> Stop
          </button>
        ) : (
          <button
            className="btn btn-sm btn-run"
            onClick={() => run()}
            disabled={!activeNode || info?.kind === "unavailable" || rewind.active}
            data-tip={info?.kind === "unavailable" ? info.reason : `Run ${activeNode?.name ?? "file"} (${modKey}+Enter)`}
          >
            <Play /> {info?.kind === "html" ? "Preview" : "Run"}
          </button>
        )}
        <button className="btn btn-sm btn-gradient" onClick={() => setModal("share")}>
          <Share2 /> Share
        </button>
      </div>
    </header>
  );
}
