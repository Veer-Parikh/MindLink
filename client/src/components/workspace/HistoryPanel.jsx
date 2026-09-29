import { useEffect, useMemo, useState } from "react";
import { Bookmark, History, PlayCircle, RotateCcw, Sparkles } from "lucide-react";
import { clock, timeAgo } from "../../lib/format.js";
import { AvatarStack, EmptyState, Spinner } from "../ui/index.jsx";
import { useWorkspace } from "./context.js";

const SESSION_GAP = 20 * 60 * 1000;

/** Collapses runs of automatic snapshots into "sessions"; checkpoints and restores stay as their own rows. */
function groupTimeline(snapshots) {
  const rows = [];
  let session = null;
  for (const s of snapshots) {
    if (s.kind === "auto") {
      if (session && s.createdAt - session.end <= SESSION_GAP) {
        session.items.push(s);
        session.end = s.createdAt;
        session.added += s.added;
        session.removed += s.removed;
        s.authorIds.forEach((id) => session.authors.add(id));
      } else {
        session = {
          type: "session",
          items: [s],
          start: s.createdAt,
          end: s.createdAt,
          added: s.added,
          removed: s.removed,
          authors: new Set(s.authorIds),
        };
        rows.push(session);
      }
    } else {
      session = null;
      rows.push({ type: s.kind, snapshot: s });
    }
  }
  return rows.reverse();
}

export default function HistoryPanel() {
  const { rewind, enterRewind, project, canEdit, setModal } = useWorkspace();
  const [loaded, setLoaded] = useState(rewind.timeline.length > 0);

  useEffect(() => {
    rewind
      .loadTimeline()
      .catch(() => {})
      .finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const members = useMemo(() => new Map(project.members.map((m) => [m.id, m])), [project.members]);
  const rows = useMemo(() => groupTimeline(rewind.timeline), [rewind.timeline]);
  const peopleFor = (ids) =>
    Array.from(ids)
      .map((id) => members.get(id))
      .filter(Boolean);

  return (
    <div className="history-panel">
      <div className="panel-header">
        <span className="panel-title">History</span>
        <div className="panel-actions">
          {canEdit && (
            <button className="icon-btn sm" onClick={() => setModal("checkpoint")} data-tip="Create checkpoint">
              <Bookmark />
            </button>
          )}
        </div>
      </div>
      <div className="history-intro">
        <button className="btn btn-sm btn-rewind btn-block" onClick={() => enterRewind()}>
          <History /> Open Rewind
        </button>
        <p>Every pause in typing becomes a snapshot. Click any moment to scrub from there.</p>
      </div>
      {!loaded ? (
        <div className="panel-loading">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={History} title="No history yet">
          Start typing — snapshots appear automatically.
        </EmptyState>
      ) : (
        <ol className="history-list">
          {rows.map((row) => {
            if (row.type === "session") {
              const first = row.items[0];
              const last = row.items[row.items.length - 1];
              return (
                <li key={`s-${first.id}`}>
                  <button className="history-row is-session" onClick={() => enterRewind({ snapshotId: last.id })}>
                    <span className="hr-rail" />
                    <div className="hr-body">
                      <div className="hr-title">
                        {row.items.length} {row.items.length === 1 ? "change" : "changes"}
                        <span className="hr-diff">
                          <span className="plus">+{row.added}</span> <span className="minus">−{row.removed}</span>
                        </span>
                      </div>
                      <div className="hr-meta">
                        <AvatarStack users={peopleFor(row.authors)} size={18} max={3} />
                        <span>
                          {row.items.length > 1 && row.start !== row.end
                            ? `${clock(row.start)} – ${clock(row.end)}`
                            : clock(row.start)}{" "}
                          · {timeAgo(row.end)}
                        </span>
                      </div>
                    </div>
                    <span
                      className="hr-play"
                      data-tip="Replay this session"
                      onClick={(e) => {
                        e.stopPropagation();
                        const startIndex = rewind.timeline.findIndex((s) => s.id === first.id);
                        const from = rewind.timeline[Math.max(0, startIndex - 1)];
                        enterRewind({ snapshotId: from.id, autoplay: true });
                      }}
                    >
                      <PlayCircle size={16} />
                    </span>
                  </button>
                </li>
              );
            }
            const s = row.snapshot;
            const author = members.get(s.createdBy);
            const Icon = row.type === "checkpoint" ? Bookmark : row.type === "restore" ? RotateCcw : Sparkles;
            return (
              <li key={s.id}>
                <button className={`history-row is-${row.type}`} onClick={() => enterRewind({ snapshotId: s.id })}>
                  <span className="hr-icon">
                    <Icon size={13} />
                  </span>
                  <div className="hr-body">
                    <div className="hr-title">
                      <span className="hr-message">{s.message || "Checkpoint"}</span>
                      {row.type !== "initial" && (
                        <span className="hr-diff">
                          <span className="plus">+{s.added}</span> <span className="minus">−{s.removed}</span>
                        </span>
                      )}
                    </div>
                    <div className="hr-meta">
                      {author && <span style={{ color: author.color }}>{author.name}</span>}
                      <span>{timeAgo(s.createdAt)}</span>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
