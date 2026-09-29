import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { modKey } from "../lib/format.js";
import { languageFor } from "../lib/languages.js";
import { useConnection, usePeers, useRoom, useYArray, useYMapValues, useYVersion } from "../collab/room.js";
import { buildTree, contentOf, exportFiles, flattenFiles, treeOf } from "../collab/model.js";
import { runInfo, runProject, stopRun } from "../runners/index.js";
import { PageLoader } from "../components/ui/index.jsx";
import { WorkspaceContext } from "../components/workspace/context.js";
import { useRewind } from "../components/workspace/useRewind.js";
import TopBar from "../components/workspace/TopBar.jsx";
import ActivityBar from "../components/workspace/ActivityBar.jsx";
import Sidebar from "../components/workspace/Sidebar.jsx";
import EditorArea from "../components/workspace/EditorArea.jsx";
import BottomPanel from "../components/workspace/BottomPanel.jsx";
import PreviewPane from "../components/workspace/PreviewPane.jsx";
import StatusBar from "../components/workspace/StatusBar.jsx";
import RewindBar from "../components/workspace/RewindBar.jsx";
import ShareModal from "../components/workspace/ShareModal.jsx";
import CheckpointModal from "../components/workspace/CheckpointModal.jsx";
import CommandPalette from "../components/workspace/CommandPalette.jsx";
import CatchupCard from "../components/workspace/CatchupCard.jsx";

const MAX_SHARED_OUTPUT = 20_000;

export default function Workspace() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { user, meta } = useAuth();

  const [project, setProject] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const room = useRoom(project ? projectId : null, user);
  const connection = useConnection(room);
  const peers = usePeers(room);
  const doc = room?.doc ?? null;

  // ── Project metadata & live role
  const loadProject = useCallback(
    () =>
      api(`/projects/${projectId}`)
        .then(({ project }) => setProject(project))
        .catch((err) => setLoadError(err.message)),
    [projectId],
  );
  useEffect(() => {
    setProject(null);
    setLoadError(null);
    loadProject();
  }, [loadProject]);

  useEffect(() => {
    if (!room) return undefined;
    return room.onEvent((event) => {
      if (event.type === "role") {
        setProject((p) => (p ? { ...p, role: event.role } : p));
        toast(`Your role changed to ${event.role}.`);
        loadProject();
      } else if (event.type === "removed") {
        toast.error("You were removed from this project.");
        navigate("/app");
      } else if (event.type === "deleted") {
        toast.error("This project was deleted.");
        navigate("/app");
      } else if (event.type === "project") {
        setProject((p) => (p ? { ...p, name: event.name, description: event.description } : p));
      } else if (event.type === "members") {
        loadProject();
      } else if (event.type === "restored" && event.by.userId !== user.id) {
        toast(`${event.by.name} restored the project from Rewind.`);
      }
    });
  }, [room, navigate, loadProject, user.id]);

  // Keep my presence (name/colour) current.
  useEffect(() => {
    room?.setPresence({ user: { id: user.id, name: user.name, color: user.color } });
  }, [room, user.id, user.name, user.color]);

  const role = project?.role ?? "viewer";
  const canEdit = role !== "viewer";

  // ── File tree (reactive)
  const tree = doc ? treeOf(doc) : null;
  const treeVersion = useYVersion(tree);
  const { nodes, files, nodeById } = useMemo(() => {
    if (!tree) return { nodes: [], files: [], nodeById: new Map() };
    const nested = buildTree(Array.from(tree.values()));
    const flat = flattenFiles(nested);
    const byId = new Map();
    const walk = (list) => list.forEach((n) => (byId.set(n.id, n), n.children && walk(n.children)));
    walk(nested);
    return { nodes: nested, files: flat, nodeById: byId };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, treeVersion]);

  // ── Tabs
  const [tabs, setTabs] = useState([]);
  const [activeFileId, setActiveFileId] = useState(null);
  const [reveal, setReveal] = useState(null); // { fileId, line, nonce }
  const [following, setFollowing] = useState(null); // userId
  const openedInitial = useRef(false);

  const openFile = useCallback((id, { line, keepFollow = false } = {}) => {
    if (!id) return;
    setTabs((t) => (t.includes(id) ? t : [...t, id]));
    setActiveFileId(id);
    if (line) setReveal({ fileId: id, line, nonce: Math.random() });
    if (!keepFollow) setFollowing(null);
  }, []);

  const closeTab = useCallback(
    (id) => {
      setTabs((t) => {
        const idx = t.indexOf(id);
        const next = t.filter((x) => x !== id);
        if (id === activeFileId) setActiveFileId(next[Math.min(idx, next.length - 1)] ?? null);
        return next;
      });
    },
    [activeFileId],
  );

  // Drop tabs for files that were deleted (by anyone).
  useEffect(() => {
    if (!tree) return;
    setTabs((t) => t.filter((id) => nodeById.has(id)));
    if (activeFileId && !nodeById.has(activeFileId)) setActiveFileId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeById]);

  // Open the template's entry file once the doc first syncs.
  useEffect(() => {
    if (openedInitial.current || !connection.synced || files.length === 0) return;
    openedInitial.current = true;
    const preferred = ["index.html", "main.py", "main.ts", "index.js", "README.md"];
    const first = preferred.map((n) => files.find((f) => f.path === n)).find(Boolean) ?? files[0];
    openFile(first.id);
  }, [connection.synced, files, openFile]);

  // Tell everyone which file I'm looking at.
  useEffect(() => {
    room?.setPresence({ fileId: activeFileId });
  }, [room, activeFileId]);

  // ── Follow mode
  const followedPeer = following ? peers.find((p) => p.user.id === following) : null;
  useEffect(() => {
    if (following && !followedPeer) {
      toast(`Stopped following — they left.`);
      setFollowing(null);
    }
  }, [following, followedPeer]);
  useEffect(() => {
    if (!followedPeer?.fileId || !nodeById.has(followedPeer.fileId)) return;
    if (followedPeer.fileId !== activeFileId) openFile(followedPeer.fileId, { keepFollow: true });
  }, [followedPeer?.fileId, activeFileId, nodeById, openFile]);

  // ── Panels
  const [sidebarView, setSidebarView] = useState("files");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [bottomOpen, setBottomOpen] = useState(false);
  const [bottomTab, setBottomTab] = useState("console");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [modal, setModal] = useState(null);
  const [paletteMode, setPaletteMode] = useState(null); // null | "files" | "commands"
  const [threadDraft, setThreadDraft] = useState(null);
  const [focusThread, setFocusThread] = useState(null);
  const editorApi = useRef(null); // set by CodeEditor: { getSelectionText, insertText, focus }

  const showSidebar = useCallback(
    (view) => {
      if (sidebarOpen && sidebarView === view) setSidebarOpen(false);
      else {
        setSidebarView(view);
        setSidebarOpen(true);
      }
    },
    [sidebarOpen, sidebarView],
  );

  const openSidebar = useCallback((view) => {
    setSidebarView(view);
    setSidebarOpen(true);
  }, []);

  // Auto-open the preview for web projects.
  const hasHtml = files.some((f) => f.name.endsWith(".html"));
  const previewAuto = useRef(false);
  useEffect(() => {
    if (!previewAuto.current && connection.synced && hasHtml) {
      previewAuto.current = true;
      setPreviewOpen(window.innerWidth > 1100);
    }
  }, [connection.synced, hasHtml]);

  // ── Chat unread
  const chat = useYArray(doc ? doc.getArray("chat") : null);
  const chatVisible = sidebarOpen && sidebarView === "chat";
  const [chatSeen, setChatSeen] = useState(null); // messages already seen (history counts as seen)
  useEffect(() => {
    if (connection.synced && (chatSeen === null || chatVisible)) setChatSeen(chat.length);
  }, [connection.synced, chatVisible, chat.length, chatSeen]);
  const prevChatLength = useRef(null);
  useEffect(() => {
    if (!connection.synced) return;
    const newest = chat[chat.length - 1];
    if (prevChatLength.current !== null && chat.length > prevChatLength.current && !chatVisible && newest?.userId !== user.id) {
      toast(`${newest.name}: ${newest.text.slice(0, 80)}`, {
        action: { label: "Reply", onClick: () => showSidebar("chat") },
      });
    }
    prevChatLength.current = chat.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.length, connection.synced]);
  const unreadChat = chatSeen === null ? 0 : Math.max(0, chat.length - chatSeen);

  const threads = useYMapValues(doc ? doc.getMap("threads") : null);
  const openThreads = threads.filter((t) => !t.resolved && nodeById.has(t.fileId));

  // ── Running code
  const [runState, setRunState] = useState({ status: "idle", lines: [], entry: null, result: null, statusText: null });
  const [stdin, setStdin] = useState("");
  const activeNode = activeFileId ? nodeById.get(activeFileId) : null;

  const run = useCallback(
    async (fileId = activeFileId) => {
      const node = fileId ? nodeById.get(fileId) : null;
      if (!node || !doc) {
        toast("Open a file to run it.");
        return;
      }
      const info = runInfo(node.name, meta);
      if (info.kind === "html") {
        setPreviewOpen(true);
        return;
      }
      if (info.kind === "unavailable") {
        toast.error(info.reason);
        return;
      }
      if (runState.status === "running") return;
      setBottomOpen(true);
      setBottomTab("console");
      const lines = [];
      let pending = false;
      const flush = () => {
        pending = false;
        setRunState((s) => ({ ...s, lines: [...lines] }));
      };
      setRunState({ status: "running", lines: [], entry: node.path, result: null, statusText: null });
      const result = await runProject({
        files: exportFiles(doc),
        entry: node.path,
        stdin,
        meta,
        onLine: (l) => {
          lines.push(l);
          if (lines.length > 5000) lines.splice(0, lines.length - 5000);
          if (!pending) {
            pending = true;
            requestAnimationFrame(flush);
          }
        },
        onStatus: (text) => setRunState((s) => ({ ...s, statusText: text })),
      });
      flush();
      setRunState((s) => ({ ...s, status: "done", result, statusText: null }));
      // Share the run with the room.
      const output = lines.map((l) => l.text).join("\n");
      api(`/projects/${projectId}/runs`, {
        method: "POST",
        body: {
          fileId: node.id,
          path: node.path,
          language: languageFor(node.name).label,
          output: output.length > MAX_SHARED_OUTPUT ? `${output.slice(0, MAX_SHARED_OUTPUT)}\n… (truncated)` : output,
          ok: result.ok,
          ms: result.ms,
        },
      }).catch(() => {});
    },
    [activeFileId, nodeById, doc, meta, runState.status, stdin, projectId],
  );

  // ── Rewind
  const rewind = useRewind(projectId, room);
  const [rewindFileId, setRewindFileId] = useState(null);
  const enterRewind = useCallback(
    (opts) => {
      setFollowing(null);
      setPaletteMode(null);
      setRewindFileId(activeFileId);
      return rewind.enter(opts);
    },
    [rewind, activeFileId],
  );

  // ── Global shortcuts (capture phase so Monaco doesn't swallow them)
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (mod && key === "k") {
        stop();
        setPaletteMode((m) => (m ? null : "commands"));
      } else if (mod && key === "p" && !e.shiftKey) {
        stop();
        setPaletteMode((m) => (m ? null : "files"));
      } else if (mod && key === "enter") {
        stop();
        run();
      } else if (mod && e.shiftKey && key === "s") {
        stop();
        if (canEdit) setModal("checkpoint");
      } else if (mod && key === "s") {
        stop();
        toast.success("Saved — MindLink saves every keystroke.", {
          description: `Press ${modKey}+Shift+S to create a named checkpoint.`,
          id: "autosave",
        });
      } else if (mod && key === "b" && !e.shiftKey) {
        stop();
        setSidebarOpen((o) => !o);
      } else if (mod && key === "j") {
        stop();
        setBottomOpen((o) => !o);
      } else if (e.altKey && key === "r" && !mod) {
        stop();
        if (rewind.active) rewind.exit();
        else enterRewind();
      } else if (key === "escape" && following) {
        setFollowing(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [run, canEdit, rewind, enterRewind, following]);

  const value = {
    project,
    setProject,
    loadProject,
    role,
    canEdit,
    user,
    meta,
    room,
    doc,
    connection,
    peers,
    nodes,
    files,
    nodeById,
    tabs,
    activeFileId,
    activeNode,
    openFile,
    closeTab,
    reveal,
    setReveal,
    following,
    setFollowing,
    followedPeer,
    sidebarView,
    sidebarOpen,
    showSidebar,
    openSidebar,
    setSidebarOpen,
    bottomOpen,
    setBottomOpen,
    bottomTab,
    setBottomTab,
    previewOpen,
    setPreviewOpen,
    modal,
    setModal,
    paletteMode,
    setPaletteMode,
    runState,
    setRunState,
    run,
    stop: stopRun,
    stdin,
    setStdin,
    rewind,
    enterRewind,
    rewindFileId,
    setRewindFileId,
    chat,
    unreadChat,
    threads,
    openThreads,
    threadDraft,
    setThreadDraft,
    focusThread,
    setFocusThread,
    editorApi,
    contentOf: doc ? contentOf(doc) : null,
  };

  if (loadError) {
    return (
      <div className="center-page">
        <h2>Can’t open this project</h2>
        <p className="muted">{loadError}</p>
        <button className="btn btn-primary" onClick={() => navigate("/app")}>
          Back to projects
        </button>
      </div>
    );
  }
  if (!project || !room) return <PageLoader label="Opening workspace…" />;

  return (
    <WorkspaceContext.Provider value={value}>
      <div className={`workspace ${rewind.active ? "is-rewinding" : ""}`}>
        <TopBar />
        <div className="ws-body">
          <ActivityBar />
          {sidebarOpen && <Sidebar />}
          <div className="ws-main">
            <div className="ws-center">
              <div className="ws-editor-col">
                <EditorArea />
                {bottomOpen && !rewind.active && <BottomPanel />}
              </div>
              {previewOpen && !rewind.active && <PreviewPane />}
            </div>
            {rewind.active && <RewindBar />}
          </div>
        </div>
        <StatusBar />
        {!connection.synced && connection.status !== "connected" && <div className="ws-connecting">Connecting to your team…</div>}
        <CatchupCard />
      </div>
      <ShareModal open={modal === "share"} onClose={() => setModal(null)} />
      <CheckpointModal open={modal === "checkpoint"} onClose={() => setModal(null)} />
      <CommandPalette />
    </WorkspaceContext.Provider>
  );
}
