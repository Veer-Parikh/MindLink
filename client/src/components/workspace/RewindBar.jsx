import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Bookmark, Columns2, Pause, Play, RotateCcw, SkipBack, SkipForward, Sparkles, X } from "lucide-react";
import { api } from "../../lib/api.js";
import { dateTime, timeAgo } from "../../lib/format.js";
import { AvatarStack, Spinner } from "../ui/index.jsx";
import { SPEEDS } from "./useRewind.js";
import { useWorkspace } from "./context.js";

const KIND_LABEL = { auto: "Auto snapshot", checkpoint: "Checkpoint", restore: "Restore", initial: "Project created" };

export default function RewindBar() {
  const { rewind, project, canEdit } = useWorkspace();
  const { timeline, index, current } = rewind;
  const track = useRef(null);
  const [hover, setHover] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const members = useMemo(() => new Map(project.members.map((m) => [m.id, m])), [project.members]);
  const n = timeline.length;
  const pct = (i) => (n <= 1 ? 100 : (i / (n - 1)) * 100);

  const indexAt = useCallback(
    (clientX) => {
      const rect = track.current.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return Math.round(ratio * (n - 1));
    },
    [n],
  );

  const onPointerDown = (e) => {
    e.preventDefault();
    track.current.setPointerCapture(e.pointerId);
    rewind.setIndex(indexAt(e.clientX));
    const move = (ev) => rewind.setIndex(indexAt(ev.clientX));
    const up = () => {
      track.current?.removeEventListener("pointermove", move);
      track.current?.removeEventListener("pointerup", up);
    };
    track.current.addEventListener("pointermove", move);
    track.current.addEventListener("pointerup", up);
  };

  // Keyboard: ← → step, space play/pause, Esc exit.
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      const inReadOnlyEditor = e.target.closest?.(".rewind-area");
      if (!inReadOnlyEditor && (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable)) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        rewind.setIndex(index - (e.shiftKey ? 10 : 1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        rewind.setIndex(index + (e.shiftKey ? 10 : 1));
      } else if (e.key === " ") {
        e.preventDefault();
        if (!rewind.playing && index >= n - 1) rewind.setIndex(0);
        rewind.setPlaying((p) => !p);
      } else if (e.key === "Escape") {
        rewind.exit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rewind, index, n]);

  async function restore() {
    if (!current) return;
    if (
      !window.confirm(
        "Restore the whole project to this moment for everyone? (The current state stays on the timeline, so you can undo this.)",
      )
    )
      return;
    setRestoring(true);
    try {
      await api(`/projects/${project.id}/snapshots/${current.id}/restore`, { method: "POST" });
      toast.success("Project restored", { description: "Everyone is now on this version." });
      rewind.exit();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRestoring(false);
    }
  }

  if (!current) return null;
  const authors = current.authorIds.map((id) => members.get(id)).filter(Boolean);
  const isLatest = index === n - 1;
  const hovered = hover != null ? timeline[hover] : null;

  return (
    <div className="rewind-bar">
      <div className="rb-controls">
        <button className="icon-btn" onClick={() => rewind.setIndex(index - 1)} disabled={index === 0} data-tip="Previous (←)">
          <SkipBack />
        </button>
        <button
          className="rb-play"
          onClick={() => {
            if (!rewind.playing && isLatest) rewind.setIndex(0);
            rewind.setPlaying((p) => !p);
          }}
          data-tip={rewind.playing ? "Pause (Space)" : "Play (Space)"}
        >
          {rewind.playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button className="icon-btn" onClick={() => rewind.setIndex(index + 1)} disabled={isLatest} data-tip="Next (→)">
          <SkipForward />
        </button>
        <button className="rb-speed" onClick={rewind.cycleSpeed} data-tip="Playback speed">
          {SPEEDS[rewind.speed].label}
        </button>
      </div>

      <div className="rb-timeline">
        <div className="rb-info">
          <span className={`rb-kind is-${current.kind}`}>
            {current.kind === "checkpoint" ? (
              <Bookmark size={12} />
            ) : current.kind === "restore" ? (
              <RotateCcw size={12} />
            ) : (
              <Sparkles size={12} />
            )}
            {KIND_LABEL[current.kind]}
          </span>
          {current.message && !["auto", "initial"].includes(current.kind) && (
            <span className="rb-message">{current.message}</span>
          )}
          <span className="rb-when">
            {dateTime(current.createdAt)} <span className="muted">· {timeAgo(current.createdAt)}</span>
          </span>
          {authors.length > 0 && <AvatarStack users={authors} size={20} max={4} />}
          <span className="rb-diff">
            <span className="plus">+{current.added}</span> <span className="minus">−{current.removed}</span>
          </span>
          <span className="rb-count">
            {index + 1} / {n}
          </span>
        </div>
        <div
          className="rb-track"
          ref={track}
          onPointerDown={onPointerDown}
          onPointerMove={(e) => setHover(indexAt(e.clientX))}
          onPointerLeave={() => setHover(null)}
          role="slider"
          aria-valuemin={1}
          aria-valuemax={n}
          aria-valuenow={index + 1}
          aria-label="Rewind timeline"
        >
          <div className="rb-rail" />
          <div className="rb-fill" style={{ width: `${pct(index)}%` }} />
          {timeline.map((s, i) => {
            const color = members.get(s.authorIds[0] ?? s.createdBy)?.color ?? "#7d869a";
            return (
              <span
                key={s.id}
                className={`rb-tick is-${s.kind} ${i <= index ? "is-past" : ""}`}
                style={{ left: `${pct(i)}%`, "--c": color }}
              />
            );
          })}
          <span className="rb-handle" style={{ left: `${pct(index)}%` }} />
          {hovered && (
            <div className="rb-hover" style={{ left: `${pct(hover)}%` }}>
              <strong>{hovered.message && hovered.kind !== "auto" ? hovered.message : KIND_LABEL[hovered.kind]}</strong>
              <span>
                {timeAgo(hovered.createdAt)} ·{" "}
                {hovered.authorIds
                  .map((id) => members.get(id)?.name)
                  .filter(Boolean)
                  .join(", ") || "—"}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="rb-actions">
        <button
          className={`btn btn-sm ${rewind.compare ? "is-toggled" : ""}`}
          onClick={() => rewind.setCompare((c) => !c)}
          data-tip="Compare this moment with now"
        >
          <Columns2 /> Compare
        </button>
        {canEdit && (
          <button
            className="btn btn-sm btn-primary"
            onClick={restore}
            disabled={restoring || isLatest}
            data-tip={isLatest ? "This is the latest state" : "Bring the project back to this moment"}
          >
            {restoring ? <Spinner size={14} /> : <RotateCcw />} Restore
          </button>
        )}
        <button className="icon-btn" onClick={rewind.exit} data-tip="Exit Rewind (Esc)">
          <X />
        </button>
      </div>
    </div>
  );
}
