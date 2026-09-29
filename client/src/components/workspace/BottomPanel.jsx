import { useLayoutEffect, useRef, useState } from "react";
import { Ban, CheckCircle2, ChevronDown, Keyboard, Play, RotateCw, Users, XCircle } from "lucide-react";
import { duration, timeAgo } from "../../lib/format.js";
import { useYArray } from "../../collab/room.js";
import { Avatar, Spinner } from "../ui/index.jsx";
import { useWorkspace } from "./context.js";

function ConsoleView() {
  const { runState, run, activeNode, stdin, setStdin } = useWorkspace();
  const [showStdin, setShowStdin] = useState(Boolean(stdin));
  const scroller = useRef(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [runState.lines]);

  return (
    <div className="console">
      {showStdin && (
        <div className="stdin-row">
          <Keyboard size={14} />
          <textarea
            className="textarea"
            rows={2}
            value={stdin}
            onChange={(e) => setStdin(e.target.value)}
            placeholder="Program input (stdin) — one value per line, used by input() / readline"
          />
        </div>
      )}
      <div className="console-scroll" ref={scroller}>
        {runState.status === "idle" ? (
          <div className="console-empty">
            <Play size={16} />
            <span>
              Press <strong>Run</strong> to execute {activeNode ? <code>{activeNode.name}</code> : "the active file"}. Output is
              shared with everyone in the room.
            </span>
          </div>
        ) : (
          <>
            <div className="console-cmd">
              <span className="prompt">❯</span> run {runState.entry}
            </div>
            {runState.lines.map((l, i) => (
              <div key={i} className={`console-line is-${l.stream}`}>
                {l.text}
              </div>
            ))}
            {runState.status === "running" && (
              <div className="console-status">
                <Spinner size={12} /> {runState.statusText ?? "Running…"}
              </div>
            )}
            {runState.result && (
              <div className={`console-result ${runState.result.ok ? "is-ok" : "is-err"}`}>
                {runState.result.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                {runState.result.ok ? "Finished" : runState.result.stopped ? "Stopped" : "Failed"} in{" "}
                {duration(runState.result.ms)}
                <button className="btn btn-ghost btn-sm" onClick={() => run()}>
                  <RotateCw /> Run again
                </button>
              </div>
            )}
          </>
        )}
      </div>
      <button
        className={`stdin-toggle ${showStdin ? "is-on" : ""}`}
        onClick={() => setShowStdin((v) => !v)}
        data-tip="Provide stdin"
      >
        <Keyboard size={13} /> stdin
      </button>
    </div>
  );
}

function TeamRuns() {
  const { doc, openFile, nodeById } = useWorkspace();
  const runs = useYArray(doc.getArray("runs"));
  const [open, setOpen] = useState(null);
  const list = [...runs].reverse();
  if (list.length === 0) {
    return (
      <div className="console-empty">
        <Users size={16} />
        <span>When anyone in the room runs code, it shows up here — like a shared terminal.</span>
      </div>
    );
  }
  return (
    <div className="team-runs">
      {list.map((r) => (
        <div key={r.id} className={`team-run ${open === r.id ? "is-open" : ""}`}>
          <button className="team-run-head" onClick={() => setOpen(open === r.id ? null : r.id)}>
            <Avatar user={{ name: r.name, color: r.color }} size={20} />
            <span className="tr-who">{r.name}</span>
            <span className="tr-what">
              ran{" "}
              <code
                onClick={(e) => {
                  if (!nodeById.has(r.fileId)) return;
                  e.stopPropagation();
                  openFile(r.fileId);
                }}
              >
                {r.path}
              </code>
            </span>
            <span className={`tr-status ${r.ok ? "is-ok" : "is-err"}`}>
              {r.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
            </span>
            <span className="tr-time">
              {duration(r.ms)} · {timeAgo(r.ts)}
            </span>
            <ChevronDown size={14} className="tr-chevron" />
          </button>
          {open === r.id && <pre className="team-run-output">{r.output || "(no output)"}</pre>}
        </div>
      ))}
    </div>
  );
}

export default function BottomPanel() {
  const { bottomTab, setBottomTab, setBottomOpen, runState, setRunState, doc } = useWorkspace();
  const runsCount = useYArray(doc.getArray("runs")).length;
  const [height, setHeight] = useState(260);

  const startResize = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const move = (ev) => setHeight(Math.max(120, Math.min(window.innerHeight * 0.7, startH - (ev.clientY - startY))));
    const up = () => {
      document.body.classList.remove("is-resizing-v");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    document.body.classList.add("is-resizing-v");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <section className="bottom-panel" style={{ height }}>
      <div className="bp-resizer" onPointerDown={startResize} />
      <div className="bp-tabs">
        <button className={bottomTab === "console" ? "is-active" : ""} onClick={() => setBottomTab("console")}>
          Console
          {runState.status === "running" && <Spinner size={10} />}
        </button>
        <button className={bottomTab === "runs" ? "is-active" : ""} onClick={() => setBottomTab("runs")}>
          Team runs {runsCount > 0 && <span className="bp-count">{runsCount}</span>}
        </button>
        <div className="bp-actions">
          {bottomTab === "console" && runState.status !== "running" && runState.lines.length > 0 && (
            <button
              className="icon-btn sm"
              onClick={() => setRunState({ status: "idle", lines: [], entry: null, result: null })}
              data-tip="Clear"
            >
              <Ban />
            </button>
          )}
          <button className="icon-btn sm" onClick={() => setBottomOpen(false)} data-tip="Hide panel">
            <ChevronDown />
          </button>
        </div>
      </div>
      <div className="bp-body">{bottomTab === "console" ? <ConsoleView /> : <TeamRuns />}</div>
    </section>
  );
}
