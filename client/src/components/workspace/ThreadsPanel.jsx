import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, CornerDownLeft, MessageSquarePlus, MessageSquareText, RotateCcw, Trash2, X } from "lucide-react";
import { timeAgo } from "../../lib/format.js";
import { threadApi, threadLine } from "../../collab/threads.js";
import { useYVersion } from "../../collab/room.js";
import { Avatar, EmptyState, FileIcon, Spinner } from "../ui/index.jsx";
import { useWorkspace } from "./context.js";

function Composer({ placeholder, onSubmit, autoFocus, onCancel }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(text.trim());
      setText("");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="composer">
      <textarea
        className="textarea"
        rows={2}
        value={text}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") onCancel?.();
        }}
      />
      <div className="composer-actions">
        {onCancel && (
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="btn btn-primary btn-sm" onClick={submit} disabled={!text.trim() || busy}>
          {busy ? <Spinner size={12} /> : <CornerDownLeft />} Send
        </button>
      </div>
    </div>
  );
}

export default function ThreadsPanel() {
  const { project, doc, threads, nodeById, openFile, threadDraft, setThreadDraft, focusThread, setFocusThread, user, contentOf } =
    useWorkspace();
  const [filter, setFilter] = useState("open");
  const tapi = useMemo(() => threadApi(project.id), [project.id]);
  const contentVersion = useYVersion(contentOf);
  const refs = useRef(new Map());

  const visible = useMemo(
    () =>
      threads
        .filter((t) => nodeById.has(t.fileId) && (filter === "open" ? !t.resolved : t.resolved))
        .map((t) => ({ ...t, currentLine: threadLine(doc, t) }))
        .sort((a, b) => nodeById.get(a.fileId).path.localeCompare(nodeById.get(b.fileId).path) || a.currentLine - b.currentLine),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [threads, filter, nodeById, doc, contentVersion],
  );

  useEffect(() => {
    if (!focusThread) return;
    const t = threads.find((x) => x.id === focusThread);
    if (t && t.resolved && filter !== "resolved") setFilter("resolved");
    const el = refs.current.get(focusThread);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = setTimeout(() => setFocusThread(null), 1800);
    return () => clearTimeout(timer);
  }, [focusThread, threads, filter, setFocusThread]);

  return (
    <div className="threads-panel">
      <div className="panel-header">
        <span className="panel-title">Code threads</span>
        <div className="segmented">
          <button className={filter === "open" ? "is-active" : ""} onClick={() => setFilter("open")}>
            Open
          </button>
          <button className={filter === "resolved" ? "is-active" : ""} onClick={() => setFilter("resolved")}>
            Resolved
          </button>
        </div>
      </div>

      <div className="threads-scroll">
        {threadDraft && (
          <div className="thread-card is-draft">
            <div className="thread-head">
              <FileIcon name={nodeById.get(threadDraft.fileId)?.name ?? ""} />
              <span className="thread-loc">
                {nodeById.get(threadDraft.fileId)?.path}:{threadDraft.line}
              </span>
              <button className="icon-btn sm" onClick={() => setThreadDraft(null)} aria-label="Cancel">
                <X />
              </button>
            </div>
            {threadDraft.quote && <pre className="thread-quote">{threadDraft.quote}</pre>}
            <Composer
              autoFocus
              placeholder="Start a thread on this line…"
              onCancel={() => setThreadDraft(null)}
              onSubmit={async (text) => {
                const { thread } = await tapi.create({ ...threadDraft, text });
                setThreadDraft(null);
                setFilter("open");
                setFocusThread(thread.id);
              }}
            />
          </div>
        )}

        {visible.length === 0 && !threadDraft ? (
          <EmptyState
            icon={filter === "open" ? MessageSquarePlus : MessageSquareText}
            title={filter === "open" ? "No open threads" : "Nothing resolved yet"}
          >
            {filter === "open"
              ? "Right-click a line in the editor and choose “Comment on line” to start a discussion pinned to the code."
              : "Resolved threads land here."}
          </EmptyState>
        ) : (
          visible.map((t) => {
            const node = nodeById.get(t.fileId);
            const starter = t.comments[0];
            return (
              <div
                key={t.id}
                ref={(el) => (el ? refs.current.set(t.id, el) : refs.current.delete(t.id))}
                className={`thread-card ${focusThread === t.id ? "is-focused" : ""} ${t.resolved ? "is-resolved" : ""}`}
              >
                <button className="thread-head" onClick={() => openFile(t.fileId, { line: t.currentLine })}>
                  <FileIcon name={node.name} />
                  <span className="thread-loc">
                    {node.path}:{t.currentLine}
                  </span>
                </button>
                {t.quote && <pre className="thread-quote">{t.quote}</pre>}
                <div className="thread-comments">
                  {t.comments.map((c) => (
                    <div key={c.id} className="thread-comment">
                      <Avatar user={{ name: c.name, color: c.color }} size={22} />
                      <div>
                        <div className="tc-meta">
                          <strong>{c.name}</strong>
                          <span>{timeAgo(c.ts)}</span>
                        </div>
                        <p>{c.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="thread-actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => tapi.resolve(t.id, !t.resolved).catch((e) => toast.error(e.message))}
                  >
                    {t.resolved ? <RotateCcw /> : <Check />} {t.resolved ? "Reopen" : "Resolve"}
                  </button>
                  {(starter?.userId === user.id || project.role === "owner") && (
                    <button
                      className="icon-btn sm"
                      data-tip="Delete thread"
                      onClick={() =>
                        window.confirm("Delete this thread?") && tapi.remove(t.id).catch((e) => toast.error(e.message))
                      }
                    >
                      <Trash2 />
                    </button>
                  )}
                </div>
                {!t.resolved && <Composer placeholder="Reply…" onSubmit={(text) => tapi.reply(t.id, text)} />}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
