import { useCallback, useRef, useState } from "react";
import { useWorkspace } from "./context.js";
import Explorer from "./Explorer.jsx";
import SearchPanel from "./SearchPanel.jsx";
import HistoryPanel from "./HistoryPanel.jsx";
import ThreadsPanel from "./ThreadsPanel.jsx";
import ChatPanel from "./ChatPanel.jsx";
import PairPanel from "./PairPanel.jsx";
import { RewindExplorer } from "./RewindView.jsx";

const VIEWS = {
  files: Explorer,
  search: SearchPanel,
  history: HistoryPanel,
  threads: ThreadsPanel,
  chat: ChatPanel,
  pair: PairPanel,
};

function readWidth() {
  try {
    return Number(localStorage.getItem("mindlink.sidebarWidth")) || 272;
  } catch {
    return 272;
  }
}

export default function Sidebar() {
  const { sidebarView, rewind } = useWorkspace();
  const [width, setWidth] = useState(readWidth);
  const dragging = useRef(false);

  const startResize = useCallback(
    (e) => {
      e.preventDefault();
      dragging.current = true;
      const startX = e.clientX;
      const startW = width;
      let latest = startW;
      const move = (ev) => {
        latest = Math.max(200, Math.min(560, startW + ev.clientX - startX));
        setWidth(latest);
      };
      const up = () => {
        dragging.current = false;
        document.body.classList.remove("is-resizing");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        try {
          localStorage.setItem("mindlink.sidebarWidth", String(latest));
        } catch {
          /* ignore */
        }
      };
      document.body.classList.add("is-resizing");
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [width],
  );

  const View = rewind.active && sidebarView === "files" ? RewindExplorer : (VIEWS[sidebarView] ?? Explorer);
  return (
    <aside className="sidebar" style={{ width }}>
      <View />
      <div className="sidebar-resizer" onPointerDown={startResize} role="separator" aria-orientation="vertical" />
    </aside>
  );
}
