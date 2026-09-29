import { Bot, Files, History, MessageSquareText, MessagesSquare, Search, TerminalSquare } from "lucide-react";
import { modKey } from "../../lib/format.js";
import { useWorkspace } from "./context.js";

export default function ActivityBar() {
  const { sidebarView, sidebarOpen, showSidebar, unreadChat, openThreads, bottomOpen, setBottomOpen } = useWorkspace();
  const items = [
    { id: "files", icon: Files, label: `Explorer (${modKey}+B)` },
    { id: "search", icon: Search, label: "Search in files" },
    { id: "history", icon: History, label: "History & checkpoints" },
    { id: "threads", icon: MessageSquareText, label: "Code threads", badge: openThreads.length, badgeTone: "muted" },
    { id: "chat", icon: MessagesSquare, label: "Team chat", badge: unreadChat },
    { id: "pair", icon: Bot, label: "Pair — AI teammate" },
  ];
  return (
    <nav className="activity-bar" aria-label="Workspace views">
      {items.map((item) => (
        <button
          key={item.id}
          className={`ab-item ${sidebarOpen && sidebarView === item.id ? "is-active" : ""}`}
          onClick={() => showSidebar(item.id)}
          data-tip={item.label}
          data-tip-side="right"
          aria-label={item.label}
        >
          <item.icon />
          {item.badge > 0 && (
            <span className={`ab-badge ${item.badgeTone === "muted" ? "is-muted" : ""}`}>
              {item.badge > 99 ? "99+" : item.badge}
            </span>
          )}
        </button>
      ))}
      <div className="ab-spacer" />
      <button
        className={`ab-item ${bottomOpen ? "is-active" : ""}`}
        onClick={() => setBottomOpen((o) => !o)}
        data-tip={`Console (${modKey}+J)`}
        data-tip-side="right"
        aria-label="Toggle console"
      >
        <TerminalSquare />
      </button>
    </nav>
  );
}
