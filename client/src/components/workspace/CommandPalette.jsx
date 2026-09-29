import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import {
  Bookmark,
  Bot,
  Download,
  Eye,
  EyeOff,
  FilePlus2,
  GitFork,
  Globe,
  History,
  LayoutDashboard,
  Link2,
  MessagesSquare,
  PanelLeft,
  Play,
  Search,
  Share2,
  TerminalSquare,
  Users,
} from "lucide-react";
import { api } from "../../lib/api.js";
import { fuzzy, modKey } from "../../lib/format.js";
import { createAtPath } from "../../collab/model.js";
import { uniquePeople } from "../../collab/room.js";
import { FileIcon, Kbd } from "../ui/index.jsx";
import { downloadZip } from "./Explorer.jsx";
import { useWorkspace } from "./context.js";

function Highlighted({ text, indices }) {
  if (!indices?.length) return text;
  const set = new Set(indices);
  return [...text].map((ch, i) => (set.has(i) ? <b key={i}>{ch}</b> : ch));
}

function PaletteBody({ initialMode }) {
  const ws = useWorkspace();
  const {
    setPaletteMode,
    files,
    openFile,
    run,
    setPreviewOpen,
    setBottomOpen,
    setSidebarOpen,
    openSidebar,
    setModal,
    enterRewind,
    doc,
    project,
    canEdit,
    peers,
    following,
    setFollowing,
  } = ws;
  const navigate = useNavigate();
  // Mounted fresh on every open, so the initial query exists before the first keystroke lands.
  const [query, setQuery] = useState(initialMode === "commands" ? ">" : "");
  const [selected, setSelected] = useState(0);
  const [creating, setCreating] = useState(false);
  const listRef = useRef(null);

  const close = () => setPaletteMode(null);

  const commands = useMemo(() => {
    const list = [
      { id: "run", label: "Run active file", icon: Play, kbd: `${modKey} ↵`, run: () => run() },
      canEdit && {
        id: "new",
        label: "New file…",
        icon: FilePlus2,
        keep: true,
        run: () => {
          setCreating(true);
          setQuery("");
        },
      },
      canEdit && {
        id: "checkpoint",
        label: "Create checkpoint",
        icon: Bookmark,
        kbd: `${modKey} ⇧ S`,
        run: () => setModal("checkpoint"),
      },
      { id: "rewind", label: "Open Rewind timeline", icon: History, kbd: "Alt R", run: () => enterRewind() },
      {
        id: "replay",
        label: "Replay the whole project history",
        icon: History,
        run: () =>
          api(`/projects/${project.id}/timeline`).then(
            ({ snapshots }) => snapshots[0] && enterRewind({ snapshotId: snapshots[0].id, autoplay: true }),
          ),
      },
      { id: "share", label: "Invite people / manage access", icon: Share2, run: () => setModal("share") },
      project.inviteCode && {
        id: "copy-link",
        label: "Copy invite link",
        icon: Link2,
        run: () => {
          navigator.clipboard?.writeText(`${window.location.origin}/join/${project.inviteCode}`);
          toast.success("Invite link copied");
        },
      },
      { id: "preview", label: "Toggle live preview", icon: Globe, run: () => setPreviewOpen((v) => !v) },
      { id: "console", label: "Toggle console", icon: TerminalSquare, kbd: `${modKey} J`, run: () => setBottomOpen((v) => !v) },
      { id: "sidebar", label: "Toggle sidebar", icon: PanelLeft, kbd: `${modKey} B`, run: () => setSidebarOpen((v) => !v) },
      { id: "search", label: "Search in all files", icon: Search, run: () => openSidebar("search") },
      { id: "chat", label: "Open team chat", icon: MessagesSquare, run: () => openSidebar("chat") },
      { id: "pair", label: "Ask Pair (AI)", icon: Bot, run: () => openSidebar("pair") },
      { id: "zip", label: "Download project as .zip", icon: Download, run: () => downloadZip(doc, project.name) },
      {
        id: "fork",
        label: "Fork this project",
        icon: GitFork,
        run: async () => {
          try {
            const { projectId } = await api(`/projects/${project.id}/duplicate`, { method: "POST", body: {} });
            toast.success("Forked! Opening your copy…");
            navigate(`/p/${projectId}`);
          } catch (err) {
            toast.error(err.message);
          }
        },
      },
      ...uniquePeople(peers).map((p) => ({
        id: `follow-${p.user.id}`,
        label: `Follow ${p.user.name}`,
        icon: Eye,
        run: () => setFollowing(p.user.id),
      })),
      following && { id: "unfollow", label: "Stop following", icon: EyeOff, run: () => setFollowing(null) },
      { id: "dashboard", label: "Go to all projects", icon: LayoutDashboard, run: () => navigate("/app") },
    ];
    return list.filter(Boolean);
  }, [
    canEdit,
    run,
    setModal,
    enterRewind,
    project,
    setPreviewOpen,
    setBottomOpen,
    setSidebarOpen,
    openSidebar,
    doc,
    navigate,
    peers,
    following,
    setFollowing,
  ]);

  const items = useMemo(() => {
    if (creating) return [];
    if (query.startsWith(">")) {
      const q = query.slice(1).trim();
      return commands
        .map((c) => ({ ...c, kind: "command", match: fuzzy(q, c.label) }))
        .filter((c) => c.match.score >= 0)
        .sort((a, b) => (q ? b.match.score - a.match.score : 0));
    }
    return files
      .map((f) => ({ id: f.id, kind: "file", file: f, match: fuzzy(query, f.path) }))
      .filter((f) => f.match.score >= 0)
      .sort((a, b) => b.match.score - a.match.score)
      .slice(0, 60);
  }, [query, files, commands, creating]);

  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(".is-selected")?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const choose = (item) => {
    if (!item) return;
    if (item.kind === "file") {
      openFile(item.id);
      close();
    } else {
      if (!item.keep) close();
      item.run();
    }
  };

  const createFile = () => {
    const path = query.trim().replace(/^\/+/, "");
    if (!path || path.endsWith("/")) return;
    const exists = files.find((f) => f.path.toLowerCase() === path.toLowerCase());
    if (exists) {
      openFile(exists.id);
      close();
      return;
    }
    if (path.split("/").some((seg) => /[\\:*?"<>|]/.test(seg) || seg === "." || seg === "..")) {
      toast.error("That path has characters that aren't allowed.");
      return;
    }
    const id = createAtPath(doc, path);
    openFile(id);
    close();
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (creating) createFile();
      else choose(items[selected]);
    }
  };

  return (
    <motion.div
      className="palette-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <motion.div
        className="palette"
        initial={{ opacity: 0, y: -10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.16 }}
      >
        <div className="palette-input">
          {creating ? <FilePlus2 size={16} /> : <Search size={16} />}
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              creating ? "path/to/new-file.js — folders are created automatically" : "Search files, or type > for commands"
            }
            spellCheck={false}
          />
          <Kbd>Esc</Kbd>
        </div>
        <div className="palette-list" ref={listRef}>
          {creating ? (
            <div className="palette-hint">
              Press <Kbd>Enter</Kbd> to create <code>{query || "…"}</code>
            </div>
          ) : items.length === 0 ? (
            <div className="palette-hint">No matches</div>
          ) : (
            items.map((item, i) => (
              <button
                key={item.id}
                className={`palette-item ${i === selected ? "is-selected" : ""}`}
                onMouseMove={() => setSelected(i)}
                onClick={() => choose(item)}
              >
                {item.kind === "file" ? (
                  <>
                    <FileIcon name={item.file.name} />
                    <span className="pi-label">
                      <Highlighted text={item.file.path} indices={item.match.indices} />
                    </span>
                  </>
                ) : (
                  <>
                    <item.icon size={15} className="pi-icon" />
                    <span className="pi-label">{item.label}</span>
                    {item.kbd && <Kbd>{item.kbd}</Kbd>}
                  </>
                )}
              </button>
            ))
          )}
        </div>
        <div className="palette-foot">
          <span>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span>
            <Kbd>↵</Kbd> open
          </span>
          <span>
            <Kbd>&gt;</Kbd> commands
          </span>
          <span className="palette-foot-right">
            <Users size={12} /> {uniquePeople(peers).length + 1} in this room
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function CommandPalette() {
  const { paletteMode } = useWorkspace();
  return createPortal(
    <AnimatePresence>{paletteMode && <PaletteBody key={paletteMode} initialMode={paletteMode} />}</AnimatePresence>,
    document.body,
  );
}
