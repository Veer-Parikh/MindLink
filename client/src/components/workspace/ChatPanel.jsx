import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { MessagesSquare, SendHorizontal } from "lucide-react";
import { api } from "../../lib/api.js";
import { clock } from "../../lib/format.js";
import { uniquePeople } from "../../collab/room.js";
import { Avatar, EmptyState } from "../ui/index.jsx";
import { useWorkspace } from "./context.js";

const GROUP_WINDOW = 5 * 60 * 1000;

function linkify(text) {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noreferrer">
        {part}
      </a>
    ) : (
      part
    ),
  );
}

export default function ChatPanel() {
  const { chat, project, user, peers } = useWorkspace();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scroller = useRef(null);
  const stick = useRef(true);
  const online = uniquePeople(peers);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat.length]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setText("");
    stick.current = true;
    try {
      await api(`/projects/${project.id}/chat`, { method: "POST", body: { text: body } });
    } catch (err) {
      toast.error(err.message);
      setText(body);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="chat-panel">
      <div className="panel-header">
        <span className="panel-title">Team chat</span>
        <span className="muted chat-online">{online.length + 1} online</span>
      </div>
      <div
        className="chat-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {chat.length === 0 ? (
          <EmptyState icon={MessagesSquare} title="Say hello 👋">
            Messages are saved with the project, so latecomers can scroll back.
          </EmptyState>
        ) : (
          chat.map((m, i) => {
            const prev = chat[i - 1];
            const grouped = prev && prev.userId === m.userId && m.ts - prev.ts < GROUP_WINDOW;
            const mine = m.userId === user.id;
            return (
              <div key={m.id} className={`chat-msg ${grouped ? "is-grouped" : ""} ${mine ? "is-mine" : ""}`}>
                {!grouped && <Avatar user={{ name: m.name, color: m.color }} size={26} />}
                <div className="chat-body">
                  {!grouped && (
                    <div className="chat-meta">
                      <strong style={{ color: m.color }}>{mine ? "You" : m.name}</strong>
                      <span>{clock(m.ts)}</span>
                    </div>
                  )}
                  <p>{linkify(m.text)}</p>
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="chat-input">
        <textarea
          className="textarea"
          rows={1}
          value={text}
          placeholder="Message the team…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="icon-btn is-active" onClick={send} disabled={!text.trim()} aria-label="Send">
          <SendHorizontal />
        </button>
      </div>
    </div>
  );
}
