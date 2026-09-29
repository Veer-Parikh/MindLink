import { useEffect, useState } from "react";
import { Cloud, CloudOff, History, Loader2, Users } from "lucide-react";
import { languageFor } from "../../lib/languages.js";
import { uniquePeople } from "../../collab/room.js";
import { cursorBus } from "./CodeEditor.jsx";
import { useWorkspace } from "./context.js";

export default function StatusBar() {
  const { connection, role, activeNode, peers, rewind, enterRewind } = useWorkspace();
  const [pos, setPos] = useState(null);

  useEffect(() => {
    const onCursor = (e) => setPos(e.detail);
    cursorBus.addEventListener("cursor", onCursor);
    return () => cursorBus.removeEventListener("cursor", onCursor);
  }, []);
  useEffect(() => setPos(null), [activeNode?.id]);

  const online = uniquePeople(peers).length + 1;
  const status =
    connection.status === "connected" && connection.synced
      ? { icon: Cloud, label: "Live · saved", cls: "is-live" }
      : connection.status === "connecting" || (connection.status === "connected" && !connection.synced)
        ? { icon: Loader2, label: "Connecting…", cls: "is-pending" }
        : { icon: CloudOff, label: "Offline — edits sync when you reconnect", cls: "is-offline" };

  return (
    <footer className="statusbar">
      <div className="sb-left">
        <span className={`sb-item sb-conn ${status.cls}`}>
          <status.icon size={12} /> {status.label}
        </span>
        <span className="sb-item">
          <Users size={12} /> {online} online
        </span>
        <span className={`sb-item sb-role role-${role}`}>{role}</span>
      </div>
      <div className="sb-right">
        {rewind.active ? (
          <span className="sb-item sb-rewind">
            <History size={12} /> Rewinding · {rewind.index + 1}/{rewind.timeline.length}
          </span>
        ) : (
          <button className="sb-item sb-button" onClick={() => enterRewind()}>
            <History size={12} /> Rewind
          </button>
        )}
        {activeNode && !rewind.active && (
          <>
            {pos && (
              <span className="sb-item">
                Ln {pos.line}, Col {pos.col}
              </span>
            )}
            <span className="sb-item">Spaces: 2</span>
            <span className="sb-item">UTF-8</span>
            <span className="sb-item">{languageFor(activeNode.name).label}</span>
          </>
        )}
      </div>
    </footer>
  );
}
