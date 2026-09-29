import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import {
  Bot,
  Bug,
  Check,
  ClipboardCopy,
  FileText,
  FlaskConical,
  Layers,
  Lightbulb,
  SendHorizontal,
  Sparkles,
  Square,
  TextCursorInput,
  Trash2,
} from "lucide-react";
import { apiStream } from "../../lib/api.js";
import { FileIcon } from "../ui/index.jsx";
import { useWorkspace } from "./context.js";

const QUICK = [
  { icon: Lightbulb, label: "Explain this file", prompt: "Explain what this file does, walking through the important parts." },
  {
    icon: Bug,
    label: "Find bugs",
    prompt: "Review this file for bugs, edge cases and risky code. List concrete issues with fixes.",
  },
  { icon: FlaskConical, label: "Write tests", prompt: "Write focused unit tests for this file." },
  {
    icon: Sparkles,
    label: "Suggest improvements",
    prompt: "Suggest the three most valuable improvements to this code, with code.",
  },
];

function CodeBlock({ className, children, onInsert }) {
  const [copied, setCopied] = useState(false);
  const code = String(children).replace(/\n$/, "");
  const lang = /language-(\w+)/.exec(className ?? "")?.[1];
  return (
    <div className="pair-code">
      <div className="pair-code-bar">
        <span>{lang ?? "code"}</span>
        <div>
          <button
            className="icon-btn sm"
            data-tip="Copy"
            onClick={() => {
              navigator.clipboard?.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? <Check /> : <ClipboardCopy />}
          </button>
          {onInsert && (
            <button className="icon-btn sm" data-tip="Insert at cursor" onClick={() => onInsert(code)}>
              <TextCursorInput />
            </button>
          )}
        </div>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Message({ message, onInsert }) {
  if (message.role === "user") {
    return (
      <div className="pair-msg is-user">
        <p>{message.content}</p>
        {message.context && <span className="pair-ctx-note">{message.context}</span>}
      </div>
    );
  }
  return (
    <div className="pair-msg is-assistant">
      <div className="pair-avatar">
        <Bot size={14} />
      </div>
      <div className="markdown">
        {message.content ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }) {
                const inline = !className && !String(children).includes("\n");
                if (inline) return <code {...props}>{children}</code>;
                return (
                  <CodeBlock className={className} onInsert={onInsert}>
                    {children}
                  </CodeBlock>
                );
              },
              pre: ({ children }) => <>{children}</>,
            }}
          >
            {message.content}
          </ReactMarkdown>
        ) : (
          <span className="pair-thinking">
            <span />
            <span />
            <span />
          </span>
        )}
        {message.error && <div className="form-error">{message.error}</div>}
      </div>
    </div>
  );
}

export default function PairPanel() {
  const { meta, project, activeNode, editorApi, canEdit } = useWorkspace();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [includeProject, setIncludeProject] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef(null);
  const scroller = useRef(null);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (!meta.ai) {
    return (
      <div className="pair-panel">
        <div className="panel-header">
          <span className="panel-title">Pair</span>
        </div>
        <div className="pair-setup">
          <div className="pair-setup-icon">
            <Bot />
          </div>
          <h3>Meet Pair, your AI teammate</h3>
          <p>
            Pair reads the file you’re in and helps you explain, debug, test and improve it. It also writes checkpoint messages
            and catch-up summaries.
          </p>
          <div className="pair-setup-steps">
            <span>To turn it on, add your key to the server:</span>
            <code>server/.env → GEMINI_API_KEY=…</code>
            <span>
              Get a free key at{" "}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                aistudio.google.com/apikey
              </a>
              ,
            </span>
            <span>then restart the server.</span>
          </div>
        </div>
      </div>
    );
  }

  async function ask(text) {
    const question = text.trim();
    if (!question || streaming) return;
    const selection = editorApi.current?.getSelectionText?.() ?? "";
    const contextNote = [activeNode && `📄 ${activeNode.path}`, selection && "selection", includeProject && "whole project"]
      .filter(Boolean)
      .join(" · ");
    const history = [...messages, { role: "user", content: question, context: contextNote }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    let acc = "";
    try {
      await apiStream(
        `/projects/${project.id}/ai/pair`,
        {
          messages: history.map(({ role, content }) => ({ role, content })),
          context: { fileId: activeNode?.id, selection, includeProject },
        },
        (event) => {
          if (event.type === "text") {
            acc += event.text;
            setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: acc }]);
          } else if (event.type === "error") {
            setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: acc, error: event.message }]);
          }
        },
        controller.signal,
      );
    } catch (err) {
      if (err.name !== "AbortError") {
        setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: acc, error: err.message }]);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  const insert = canEdit
    ? (code) => {
        if (!editorApi.current?.insertText) {
          toast("Open a file first.");
          return;
        }
        editorApi.current.insertText(code);
        toast.success("Inserted at your cursor");
      }
    : null;

  return (
    <div className="pair-panel">
      <div className="panel-header">
        <span className="panel-title">
          Pair <span className="badge badge-violet">AI</span>
        </span>
        <div className="panel-actions">
          {messages.length > 0 && (
            <button className="icon-btn sm" onClick={() => setMessages([])} data-tip="Clear conversation" disabled={streaming}>
              <Trash2 />
            </button>
          )}
        </div>
      </div>
      <div className="pair-scroll" ref={scroller}>
        {messages.length === 0 ? (
          <div className="pair-empty">
            <div className="pair-setup-icon">
              <Bot />
            </div>
            <p>Ask anything about your code. Pair sees the file you have open{activeNode ? ":" : "."}</p>
            {activeNode && (
              <span className="pair-file">
                <FileIcon name={activeNode.name} /> {activeNode.path}
              </span>
            )}
            <div className="pair-quick">
              {QUICK.map((q) => (
                <button key={q.label} className="pair-chip" onClick={() => ask(q.prompt)} disabled={!activeNode}>
                  <q.icon size={14} /> {q.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => <Message key={i} message={m} onInsert={insert} />)
        )}
      </div>
      <div className="pair-input">
        <div className="pair-context">
          {activeNode && (
            <span className="pair-ctx-chip">
              <FileText size={12} /> {activeNode.name}
            </span>
          )}
          <button
            className={`pair-ctx-chip toggle ${includeProject ? "is-on" : ""}`}
            onClick={() => setIncludeProject((v) => !v)}
            data-tip="Send every file as context"
          >
            <Layers size={12} /> Whole project
          </button>
        </div>
        <div className="pair-input-row">
          <textarea
            className="textarea"
            rows={2}
            value={input}
            placeholder="Ask Pair… (select code to ask about it)"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(input);
              }
            }}
          />
          {streaming ? (
            <button className="icon-btn" onClick={() => abortRef.current?.abort()} aria-label="Stop">
              <Square />
            </button>
          ) : (
            <button className="icon-btn is-active" onClick={() => ask(input)} disabled={!input.trim()} aria-label="Send">
              <SendHorizontal />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
