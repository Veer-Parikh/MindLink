import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { AnimatePresence, motion } from "motion/react";
import { Bookmark, History, Sparkles, X } from "lucide-react";
import { api } from "../../lib/api.js";
import { timeAgo } from "../../lib/format.js";
import { AvatarStack, FileIcon, Spinner } from "../ui/index.jsx";
import { useWorkspace } from "./context.js";

const STATUS_LABEL = { added: "new", modified: "edited", deleted: "deleted", renamed: "renamed" };

export default function CatchupCard() {
  const { project, connection, meta, enterRewind, files, openFile, rewind } = useWorkspace();
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState(null);
  const [summaryState, setSummaryState] = useState("idle");

  useEffect(() => {
    if (!connection.synced || data) return;
    api(`/projects/${project.id}/catchup`)
      .then(({ catchup }) => {
        setData(catchup);
        if (catchup.changes.length > 0) setOpen(true);
      })
      .catch(() => {});
  }, [connection.synced, project.id, data]);

  useEffect(() => {
    if (!open || !meta.ai || summaryState !== "idle") return;
    setSummaryState("loading");
    api(`/projects/${project.id}/ai/catchup`, { method: "POST" })
      .then((res) => {
        setSummary(res.summary);
        setSummaryState("done");
      })
      .catch(() => setSummaryState("error"));
  }, [open, meta.ai, summaryState, project.id]);

  async function replay() {
    setOpen(false);
    const timeline = await rewind.loadTimeline();
    const start = [...timeline].reverse().find((s) => s.createdAt <= data.since) ?? timeline[0];
    enterRewind({ snapshotId: start?.id, autoplay: true });
  }

  if (!data) return null;
  const who = data.authors.map((a) => a.name);
  const whoText = who.length <= 2 ? who.join(" and ") : `${who.slice(0, 2).join(", ")} and ${who.length - 2} more`;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="catchup-card"
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <div className="cu-head">
            <div className="cu-icon">
              <Sparkles size={16} />
            </div>
            <div>
              <h3>While you were away</h3>
              <p>
                {whoText || "Your team"} changed {data.changes.length} file{data.changes.length === 1 ? "" : "s"} since you left{" "}
                {timeAgo(data.since)}.
              </p>
            </div>
            <button className="icon-btn sm" onClick={() => setOpen(false)} aria-label="Dismiss">
              <X />
            </button>
          </div>

          {data.authors.length > 0 && (
            <div className="cu-authors">
              <AvatarStack users={data.authors} size={22} />
              <span className="muted">
                {data.snapshotCount} snapshot{data.snapshotCount === 1 ? "" : "s"}
              </span>
            </div>
          )}

          {meta.ai && (
            <div className="cu-summary">
              {summaryState === "loading" && (
                <span className="muted cu-loading">
                  <Spinner size={12} /> Pair is reading the changes…
                </span>
              )}
              {summary && (
                <div className="markdown">
                  <ReactMarkdown>{summary}</ReactMarkdown>
                </div>
              )}
            </div>
          )}

          <ul className="cu-files">
            {data.changes.slice(0, 6).map((c) => {
              const live = files.find((f) => f.path === c.path);
              return (
                <li key={c.path}>
                  <button disabled={!live} onClick={() => live && openFile(live.id)}>
                    <FileIcon name={c.path.split("/").pop()} />
                    <span className="cu-path">{c.path}</span>
                    <span className={`change-tag is-${c.status}`}>{STATUS_LABEL[c.status]}</span>
                    <span className="cu-diff">
                      {c.added > 0 && <span className="plus">+{c.added}</span>}
                      {c.removed > 0 && <span className="minus">−{c.removed}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
            {data.changes.length > 6 && <li className="muted cu-more">+{data.changes.length - 6} more files</li>}
          </ul>

          {data.checkpoints.length > 0 && (
            <div className="cu-checkpoints">
              {data.checkpoints.slice(-3).map((c, i) => (
                <span key={i}>
                  <Bookmark size={12} /> {c.message} <span className="muted">· {c.by}</span>
                </span>
              ))}
            </div>
          )}

          <div className="cu-actions">
            <button className="btn btn-sm btn-rewind" onClick={replay}>
              <History /> Replay what happened
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
              Got it
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
