const web = [
  {
    path: "index.html",
    content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Hello, MindLink</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <main class="card">
      <p class="eyebrow">Live preview</p>
      <h1>Build it <span>together</span>.</h1>
      <p>Every keystroke from every collaborator shows up here instantly.</p>
      <button id="clicker">Clicked <strong id="count">0</strong> times</button>
    </main>
    <script src="script.js"></script>
  </body>
</html>
`,
  },
  {
    path: "style.css",
    content: `:root {
  --bg: #0b0d12;
  --ink: #e6e9f2;
  --accent: #22d3ee;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: system-ui, sans-serif;
  color: var(--ink);
  background: radial-gradient(circle at 30% 20%, #1e293b, var(--bg) 60%);
}

.card {
  padding: 2.5rem 3rem;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  text-align: center;
}

.eyebrow { color: var(--accent); letter-spacing: 0.2em; text-transform: uppercase; font-size: 12px; }
h1 { font-size: 2.5rem; margin: 0.3em 0; }
h1 span { color: var(--accent); }

button {
  margin-top: 1rem;
  padding: 0.7rem 1.4rem;
  border: 0;
  border-radius: 999px;
  background: var(--accent);
  color: #042f2e;
  font-weight: 600;
  cursor: pointer;
}
`,
  },
  {
    path: "script.js",
    content: `const button = document.getElementById("clicker");
const count = document.getElementById("count");
let clicks = 0;

button.addEventListener("click", () => {
  clicks += 1;
  count.textContent = clicks;
  console.log("clicked", clicks);
});
`,
  },
];

const javascript = [
  {
    path: "index.js",
    content: `import { fibonacci, isPrime } from "./lib/math.js";

console.log("Welcome to MindLink 👋");

const fibs = Array.from({ length: 10 }, (_, i) => fibonacci(i));
console.log("First 10 Fibonacci numbers:", fibs.join(", "));

const primes = fibs.filter(isPrime);
console.log("Which of those are prime?", primes);
`,
  },
  {
    path: "lib/math.js",
    content: `export function fibonacci(n) {
  let [a, b] = [0, 1];
  for (let i = 0; i < n; i++) [a, b] = [b, a + b];
  return a;
}

export function isPrime(n) {
  if (n < 2) return false;
  for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
  return true;
}
`,
  },
];

const typescript = [
  {
    path: "main.ts",
    content: `import { Task, summarize } from "./tasks";

const board: Task[] = [
  { id: 1, title: "Sketch the API", done: true, owner: "ada" },
  { id: 2, title: "Wire up realtime sync", done: true, owner: "linus" },
  { id: 3, title: "Ship it", done: false, owner: "grace" },
];

console.log(summarize(board));
`,
  },
  {
    path: "tasks.ts",
    content: `export interface Task {
  id: number;
  title: string;
  done: boolean;
  owner: string;
}

export function summarize(tasks: Task[]): string {
  const done = tasks.filter((t) => t.done).length;
  const pct = Math.round((done / tasks.length) * 100);
  const open = tasks.filter((t) => !t.done).map((t) => \`  • \${t.title} (@\${t.owner})\`);
  return [\`\${done}/\${tasks.length} tasks done (\${pct}%)\`, "Still open:", ...open].join("\\n");
}
`,
  },
];

const python = [
  {
    path: "main.py",
    content: `from helpers.text import banner, word_frequencies

print(banner("MindLink"))

poem = """
Two cursors dance on a single line,
your edit and mine, in perfect time.
"""

for word, count in word_frequencies(poem)[:5]:
    print(f"{word:>10} {'█' * count} {count}")
`,
  },
  {
    path: "helpers/__init__.py",
    content: "",
  },
  {
    path: "helpers/text.py",
    content: `from collections import Counter
import re


def banner(title: str) -> str:
    line = "─" * (len(title) + 4)
    return f"┌{line}┐\\n│  {title}  │\\n└{line}┘"


def word_frequencies(text: str):
    words = re.findall(r"[a-z']+", text.lower())
    return Counter(words).most_common()
`,
  },
];

const blank = [
  {
    path: "README.md",
    content: `# New MindLink project

Create files from the explorer on the left, invite teammates with the **Share** button,
and press **Run** (Ctrl+Enter) to execute the active file.

Everything is saved automatically, and every change lands on the **Rewind** timeline.
`,
  },
];

export const TEMPLATES = {
  blank: { label: "Blank", entry: "README.md", files: blank },
  web: { label: "Web (HTML/CSS/JS)", entry: "index.html", files: web },
  javascript: { label: "JavaScript", entry: "index.js", files: javascript },
  typescript: { label: "TypeScript", entry: "main.ts", files: typescript },
  python: { label: "Python", entry: "main.py", files: python },
};
