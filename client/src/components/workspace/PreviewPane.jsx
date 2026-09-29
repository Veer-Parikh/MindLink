import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Globe, RotateCw, TerminalSquare, X } from "lucide-react";
import { exportFiles } from "../../collab/model.js";
import { useYVersion } from "../../collab/room.js";
import { buildPreview } from "../../runners/index.js";
import { useWorkspace } from "./context.js";

export default function PreviewPane() {
  const { doc, files, activeNode, setPreviewOpen, contentOf } = useWorkspace();
  const htmlFiles = files.filter((f) => f.name.endsWith(".html") || f.name.endsWith(".htm"));
  const [chosen, setChosen] = useState(null);
  const [logs, setLogs] = useState([]);
  const [showLogs, setShowLogs] = useState(false);
  const [width, setWidth] = useState(() => Math.round(window.innerWidth * 0.34));
  const [nonce, setNonce] = useState(0);
  const frame = useRef(null);

  // Preview the active HTML file if there is one, else the last chosen, else index.html.
  const target =
    (activeNode && /\.html?$/.test(activeNode.name) && activeNode) ||
    htmlFiles.find((f) => f.id === chosen) ||
    htmlFiles.find((f) => f.path === "index.html") ||
    htmlFiles[0];

  const version = useYVersion(contentOf);
  const [debounced, setDebounced] = useState(version);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(version), 350);
    return () => clearTimeout(t);
  }, [version]);

  const srcDoc = useMemo(
    () => (target ? buildPreview(exportFiles(doc), target.path) : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [target?.path, debounced, nonce, doc],
  );

  useEffect(() => setLogs([]), [srcDoc]);
  useEffect(() => {
    const onMessage = (e) => {
      if (e.source !== frame.current?.contentWindow || !e.data?.__mindlink) return;
      setLogs((l) => [...l.slice(-199), { level: e.data.level, text: e.data.text }]);
      if (e.data.level === "error") setShowLogs(true);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const startResize = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const move = (ev) => setWidth(Math.max(280, Math.min(window.innerWidth * 0.7, startW - (ev.clientX - startX))));
    const up = () => {
      document.body.classList.remove("is-resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    document.body.classList.add("is-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const openInTab = () => {
    const url = URL.createObjectURL(new Blob([srcDoc], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const errors = logs.filter((l) => l.level === "error").length;

  return (
    <aside className="preview-pane" style={{ width }}>
      <div className="pv-resizer" onPointerDown={startResize} />
      <div className="pv-bar">
        <Globe size={14} />
        {htmlFiles.length > 1 ? (
          <select className="pv-select" value={target?.id ?? ""} onChange={(e) => setChosen(e.target.value)}>
            {htmlFiles.map((f) => (
              <option key={f.id} value={f.id}>
                {f.path}
              </option>
            ))}
          </select>
        ) : (
          <span className="pv-url">{target ? target.path : "no HTML file"}</span>
        )}
        <span className="pv-live">
          <span className="live-dot" /> Live
        </span>
        <div className="pv-actions">
          <button
            className={`icon-btn sm ${showLogs ? "is-active" : ""}`}
            onClick={() => setShowLogs((v) => !v)}
            data-tip="Preview console"
          >
            <TerminalSquare />
            {errors > 0 && <span className="pv-errors">{errors}</span>}
          </button>
          <button className="icon-btn sm" onClick={() => setNonce((n) => n + 1)} data-tip="Reload">
            <RotateCw />
          </button>
          <button className="icon-btn sm" onClick={openInTab} disabled={!target} data-tip="Open in new tab">
            <ExternalLink />
          </button>
          <button className="icon-btn sm" onClick={() => setPreviewOpen(false)} data-tip="Close preview">
            <X />
          </button>
        </div>
      </div>
      <div className="pv-frame-wrap">
        {target ? (
          <iframe
            ref={frame}
            title="Live preview"
            className="pv-frame"
            srcDoc={srcDoc}
            sandbox="allow-scripts allow-modals allow-forms allow-popups"
          />
        ) : (
          <div className="pv-empty">Add an .html file to see a live preview here.</div>
        )}
      </div>
      {showLogs && (
        <div className="pv-logs">
          {logs.length === 0 ? (
            <span className="muted">console.log output from the page shows up here.</span>
          ) : (
            logs.map((l, i) => (
              <div
                key={i}
                className={`console-line is-${l.level === "error" ? "stderr" : l.level === "warn" ? "warn" : "stdout"}`}
              >
                {l.text}
              </div>
            ))
          )}
        </div>
      )}
    </aside>
  );
}
