import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import {
  ArrowRight,
  Bot,
  Eye,
  History,
  MessageSquareText,
  Pause,
  Play,
  Radio,
  Rocket,
  Share2,
  Sparkles,
  Terminal,
  Users,
} from "lucide-react";
import { Logo } from "../components/ui/index.jsx";

/* ───────────────────────── Hero: a scripted two-person editing session ───────────────────────── */

const PEOPLE = {
  ada: { name: "Ada", color: "#22d3ee" },
  linus: { name: "Linus", color: "#f472b6" },
};

const BASE_LINES = [
  'import { createServer } from "./net.js";',
  "",
  "export async function start(port) {",
  "  const server = createServer();",
  "",
  "  return server.listen(port);",
  "}",
];

// Each step types `text` at the end of `line` as `who`.
const SCRIPT = [
  { who: "ada", line: 4, text: '  server.on("join", (peer) => {' },
  { who: "linus", line: 1, text: "// realtime room server ✨", insertLine: true },
  { who: "ada", line: 6, text: "    broadcast(`${peer.name} joined`);", insertLine: true },
  { who: "linus", line: 7, text: '  server.use(rewind({ every: "4s" }));', insertLine: true },
  { who: "ada", line: 7, text: "  });", insertLine: true },
];

function useHeroScript() {
  const [state, setState] = useState({ lines: BASE_LINES, cursors: { ada: [4, 0], linus: [0, 0] }, ticks: [] });
  useEffect(() => {
    let cancelled = false;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    async function run() {
      while (!cancelled) {
        let lines = [...BASE_LINES];
        let ticks = [];
        let cursors = { ada: [4, 0], linus: [0, 0] };
        setState({ lines, cursors, ticks });
        await sleep(900);
        for (const step of SCRIPT) {
          if (cancelled) return;
          if (step.insertLine) {
            lines = [...lines.slice(0, step.line), "", ...lines.slice(step.line)];
            // Everyone below the new line moves down with their text.
            cursors = Object.fromEntries(
              Object.entries(cursors).map(([who, [l, c]]) => [who, who !== step.who && l >= step.line ? [l + 1, c] : [l, c]]),
            );
          }
          for (let i = 1; i <= step.text.length; i++) {
            if (cancelled) return;
            const current = [...lines];
            current[step.line] = step.text.slice(0, i);
            lines = current;
            cursors = { ...cursors, [step.who]: [step.line, i] };
            const snapshot = cursors;
            setState((s) => ({ ...s, lines: current, cursors: snapshot }));
            await sleep(step.text[i - 1] === " " ? 25 : 38 + Math.random() * 40);
          }
          ticks = [...ticks, step.who];
          setState((s) => ({ ...s, ticks }));
          await sleep(500);
        }
        await sleep(2600);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

function highlight(line) {
  const parts = [];
  const re = /(\/\/.*$)|("[^"]*"|`[^`]*`)|\b(import|from|export|async|function|const|return|await)\b|(\b\w+(?=\())/g;
  let last = 0;
  let m;
  while ((m = re.exec(line))) {
    if (m.index > last) parts.push(<span key={last}>{line.slice(last, m.index)}</span>);
    const cls = m[1] ? "tk-comment" : m[2] ? "tk-string" : m[3] ? "tk-keyword" : "tk-fn";
    parts.push(
      <span key={m.index} className={cls}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push(<span key={last}>{line.slice(last)}</span>);
  return parts;
}

function HeroEditor() {
  const { lines, cursors, ticks } = useHeroScript();
  return (
    <div className="hero-editor">
      <div className="he-titlebar">
        <span className="dot" style={{ background: "#f87171" }} />
        <span className="dot" style={{ background: "#fbbf24" }} />
        <span className="dot" style={{ background: "#4ade80" }} />
        <div className="he-tab">server.js</div>
        <div className="he-presence">
          {Object.values(PEOPLE).map((p) => (
            <span key={p.name} className="he-avatar" style={{ background: p.color }}>
              {p.name[0]}
            </span>
          ))}
          <span className="he-live">
            <Radio size={12} /> Live
          </span>
        </div>
      </div>
      <div className="he-code">
        {lines.map((line, i) => (
          <div key={i} className="he-line">
            <span className="he-ln">{i + 1}</span>
            <span className="he-text">
              {highlight(line)}
              {Object.entries(cursors).map(([who, [l, col]]) =>
                l === i ? (
                  <span
                    key={who}
                    className="he-caret"
                    style={{ "--c": PEOPLE[who].color, left: `calc(${col}ch)` }}
                    data-name={PEOPLE[who].name}
                  />
                ) : null,
              )}
            </span>
          </div>
        ))}
      </div>
      <div className="he-rewind">
        <History size={14} />
        <span>Rewind</span>
        <div className="he-track">
          {ticks.map((who, i) => (
            <motion.span
              key={i}
              className="he-tick"
              style={{ background: PEOPLE[who].color, left: `${8 + i * 18}%` }}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
            />
          ))}
        </div>
        <span className="he-count">{ticks.length} snapshots</span>
      </div>
    </div>
  );
}

/* ───────────────────────── Interactive Rewind demo ───────────────────────── */

const VERSIONS = [
  {
    who: "ada",
    note: "First draft",
    code: ["function total(cart) {", "  let sum = 0;", "  for (const item of cart) sum += item.price;", "  return sum;", "}"],
  },
  {
    who: "linus",
    note: "Handle quantities",
    code: [
      "function total(cart) {",
      "  let sum = 0;",
      "  for (const item of cart) sum += item.price * item.qty;",
      "  return sum;",
      "}",
    ],
  },
  {
    who: "ada",
    note: "Use reduce",
    code: ["function total(cart) {", "  return cart.reduce((sum, item) => sum + item.price * item.qty, 0);", "}"],
  },
  {
    who: "linus",
    note: "Add discounts",
    code: [
      "function total(cart, discount = 0) {",
      "  const gross = cart.reduce((sum, item) => sum + item.price * item.qty, 0);",
      "  return gross * (1 - discount);",
      "}",
    ],
  },
  {
    who: "ada",
    note: "Checkpoint: “Pricing v1”",
    code: [
      "export function total(cart, discount = 0) {",
      "  const gross = cart.reduce((sum, item) => sum + item.price * item.qty, 0);",
      "  return Math.round(gross * (1 - discount) * 100) / 100;",
      "}",
    ],
    checkpoint: true,
  },
];

function RewindDemo() {
  const [index, setIndex] = useState(VERSIONS.length - 1);
  const [playing, setPlaying] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    if (!playing) return undefined;
    timer.current = setInterval(() => {
      setIndex((i) => {
        if (i >= VERSIONS.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 1100);
    return () => clearInterval(timer.current);
  }, [playing]);

  const version = VERSIONS[index];
  const prev = VERSIONS[index - 1];
  const changed = useMemo(() => new Set(version.code.filter((l) => !prev || !prev.code.includes(l))), [version, prev]);

  return (
    <div className="rewind-demo">
      <div className="rd-code">
        <div className="rd-meta">
          <span className="rd-who" style={{ background: PEOPLE[version.who].color }}>
            {PEOPLE[version.who].name[0]}
          </span>
          <span>
            <strong>{PEOPLE[version.who].name}</strong> · {version.note}
          </span>
          <span className="rd-when">{["2h ago", "1h ago", "48m ago", "12m ago", "just now"][index]}</span>
        </div>
        <pre>
          {version.code.map((line, i) => (
            <motion.div
              key={`${index}-${i}`}
              className={`rd-line ${changed.has(line) ? "is-changed" : ""}`}
              initial={{ opacity: 0.4 }}
              animate={{ opacity: 1 }}
            >
              <span className="rd-ln">{i + 1}</span>
              {highlight(line)}
            </motion.div>
          ))}
        </pre>
      </div>
      <div className="rd-controls">
        <button
          className="icon-btn is-active"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => {
            if (!playing && index === VERSIONS.length - 1) setIndex(0);
            setPlaying((p) => !p);
          }}
        >
          {playing ? <Pause /> : <Play />}
        </button>
        <div className="rd-track">
          <input
            type="range"
            min={0}
            max={VERSIONS.length - 1}
            value={index}
            onChange={(e) => {
              setPlaying(false);
              setIndex(Number(e.target.value));
            }}
            aria-label="Rewind position"
          />
          <div className="rd-ticks">
            {VERSIONS.map((v, i) => (
              <span
                key={i}
                className={`rd-tick ${v.checkpoint ? "is-checkpoint" : ""} ${i <= index ? "is-past" : ""}`}
                style={{ left: `${(i / (VERSIONS.length - 1)) * 100}%`, "--c": PEOPLE[v.who].color }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Page ───────────────────────── */

const FEATURES = [
  {
    icon: Users,
    title: "True multiplayer editing",
    body: "Conflict-free CRDT sync means everyone types at once. Live cursors with names, selections and presence in the file tree.",
  },
  {
    icon: History,
    title: "Rewind",
    body: "Every change lands on a timeline automatically. Scrub, replay it like a video, diff any moment against now and restore in one click.",
    accent: true,
  },
  {
    icon: Sparkles,
    title: "Catch up",
    body: "Come back after a break and MindLink tells you exactly what your teammates changed while you were away — then replays it for you.",
  },
  {
    icon: Terminal,
    title: "Run anything, share output",
    body: "JavaScript, TypeScript and Python run right in the browser. Every run is shared with the room, like a team terminal.",
  },
  {
    icon: Eye,
    title: "Live preview & follow mode",
    body: "HTML projects preview as you type. Click a teammate to follow their cursor across files — perfect for pairing and demos.",
  },
  {
    icon: Bot,
    title: "Pair, your AI teammate",
    body: "Ask about the file you're in, get reviews and tests, and generate checkpoint messages from the actual diff.",
  },
  {
    icon: MessageSquareText,
    title: "Code threads & chat",
    body: "Pin conversations to lines of code. Anchors follow the code as it moves, so comments never drift.",
  },
  {
    icon: Share2,
    title: "Invite links & roles",
    body: "Share an invite code, then set people as editors or read-only viewers. Viewers can still chat, comment and run code.",
  },
];

export default function Landing() {
  return (
    <div className="landing">
      <div className="landing-glow" />
      <div className="grid-bg" />
      <header className="landing-nav">
        <Logo />
        <nav>
          <a href="#rewind">Rewind</a>
          <a href="#features">Features</a>
          <Link to="/login" className="btn btn-ghost btn-sm">
            Sign in
          </Link>
          <Link to="/signup" className="btn btn-primary btn-sm">
            Get started
          </Link>
        </nav>
      </header>

      <section className="hero">
        <motion.div
          className="hero-copy"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <span className="badge badge-violet hero-badge">
            <Sparkles /> Realtime collaborative IDE
          </span>
          <h1>
            Code together.
            <br />
            <span className="grad-text">Rewind anything.</span>
          </h1>
          <p>
            MindLink is a shared editor for your whole team, with live cursors, in-browser runs and an AI pair. It also records
            every keystroke on a timeline you can scrub, replay and restore.
          </p>
          <div className="hero-ctas">
            <Link to="/signup" className="btn btn-gradient btn-lg">
              Start a project <ArrowRight />
            </Link>
            <a href="#rewind" className="btn btn-lg">
              <History /> See Rewind
            </a>
          </div>
          <div className="hero-proof">
            <span>
              <Rocket size={14} /> No install
            </span>
            <span>
              <Users size={14} /> Unlimited collaborators
            </span>
            <span>
              <History size={14} /> Every version kept
            </span>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 24, rotateX: 8 }}
          animate={{ opacity: 1, y: 0, rotateX: 0 }}
          transition={{ duration: 0.8, delay: 0.15, ease: [0.2, 0.8, 0.2, 1] }}
          className="hero-visual"
        >
          <HeroEditor />
        </motion.div>
      </section>

      <section className="landing-section" id="rewind">
        <div className="section-head">
          <span className="eyebrow">The unique part</span>
          <h2>Your codebase, as a timeline you can scrub.</h2>
          <p>
            Most tools only remember what you remembered to commit. MindLink snapshots the whole project whenever people pause,
            credits each snapshot to its authors and lets you move through that history like a video.
          </p>
        </div>
        <RewindDemo />
        <div className="rewind-points">
          <div>
            <strong>Automatic</strong>
            <span>Snapshots happen on their own, a few seconds after typing stops.</span>
          </div>
          <div>
            <strong>Attributed</strong>
            <span>Every tick is coloured by who made the change.</span>
          </div>
          <div>
            <strong>Reversible</strong>
            <span>Restoring is itself a snapshot, so nothing is ever lost.</span>
          </div>
        </div>
      </section>

      <section className="landing-section" id="features">
        <div className="section-head">
          <span className="eyebrow">Everything in one tab</span>
          <h2>Built for teams that ship together.</h2>
        </div>
        <div className="feature-grid">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              className={`feature-card ${f.accent ? "is-accent" : ""}`}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45, delay: (i % 4) * 0.06 }}
            >
              <div className="feature-icon">
                <f.icon />
              </div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="landing-cta">
        <h2>
          Open a room. Invite your team. <span className="grad-text">Build.</span>
        </h2>
        <Link to="/signup" className="btn btn-gradient btn-lg">
          Create your free workspace <ArrowRight />
        </Link>
      </section>

      <footer className="landing-footer">
        <Logo size={22} />
        <span className="muted">Made for hackers who build together.</span>
      </footer>
    </div>
  );
}
