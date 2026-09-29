/**
 * Everything MindLink knows about a file type: Monaco language id, how to run it, and how to draw its icon.
 * runner: "js" | "ts" | "python" | "html" run in the browser; "piston" needs a PISTON_URL on the server.
 */
const LANGS = [
  { ext: ["js", "mjs", "cjs", "jsx"], id: "javascript", label: "JavaScript", runner: "js", color: "#facc15", glyph: "JS" },
  { ext: ["ts", "mts", "tsx"], id: "typescript", label: "TypeScript", runner: "ts", color: "#60a5fa", glyph: "TS" },
  { ext: ["py"], id: "python", label: "Python", runner: "python", color: "#4ade80", glyph: "PY" },
  { ext: ["html", "htm"], id: "html", label: "HTML", runner: "html", color: "#fb923c", glyph: "<>" },
  { ext: ["css"], id: "css", label: "CSS", color: "#38bdf8", glyph: "#" },
  { ext: ["scss"], id: "scss", label: "SCSS", color: "#f472b6", glyph: "S" },
  { ext: ["json"], id: "json", label: "JSON", color: "#fbbf24", glyph: "{}" },
  { ext: ["md", "markdown"], id: "markdown", label: "Markdown", color: "#a5b4fc", glyph: "M↓" },
  { ext: ["java"], id: "java", label: "Java", runner: "piston", piston: "java", color: "#f87171", glyph: "J" },
  { ext: ["c", "h"], id: "c", label: "C", runner: "piston", piston: "c", color: "#93c5fd", glyph: "C" },
  { ext: ["cpp", "cc", "hpp", "cxx"], id: "cpp", label: "C++", runner: "piston", piston: "c++", color: "#818cf8", glyph: "C+" },
  { ext: ["cs"], id: "csharp", label: "C#", runner: "piston", piston: "csharp", color: "#a78bfa", glyph: "C#" },
  { ext: ["go"], id: "go", label: "Go", runner: "piston", piston: "go", color: "#22d3ee", glyph: "GO" },
  { ext: ["rs"], id: "rust", label: "Rust", runner: "piston", piston: "rust", color: "#fb923c", glyph: "RS" },
  { ext: ["rb"], id: "ruby", label: "Ruby", runner: "piston", piston: "ruby", color: "#f87171", glyph: "RB" },
  { ext: ["php"], id: "php", label: "PHP", runner: "piston", piston: "php", color: "#a5b4fc", glyph: "PHP" },
  { ext: ["kt"], id: "kotlin", label: "Kotlin", runner: "piston", piston: "kotlin", color: "#c084fc", glyph: "KT" },
  { ext: ["swift"], id: "swift", label: "Swift", runner: "piston", piston: "swift", color: "#fb923c", glyph: "SW" },
  { ext: ["sh", "bash"], id: "shell", label: "Shell", runner: "piston", piston: "bash", color: "#86efac", glyph: "$" },
  { ext: ["sql"], id: "sql", label: "SQL", color: "#fcd34d", glyph: "DB" },
  { ext: ["yml", "yaml"], id: "yaml", label: "YAML", color: "#fda4af", glyph: "Y" },
  { ext: ["xml", "svg"], id: "xml", label: "XML", color: "#fdba74", glyph: "<>" },
  { ext: ["txt"], id: "plaintext", label: "Plain text", color: "#94a3b8", glyph: "T" },
];

const BY_EXT = new Map(LANGS.flatMap((l) => l.ext.map((e) => [e, l])));
const FALLBACK = { id: "plaintext", label: "Plain text", color: "#94a3b8", glyph: "•" };

export function languageFor(name = "") {
  const lower = name.toLowerCase();
  if (lower === "dockerfile") return { id: "dockerfile", label: "Dockerfile", color: "#38bdf8", glyph: "D" };
  const ext = lower.includes(".") ? lower.split(".").pop() : "";
  return BY_EXT.get(ext) ?? FALLBACK;
}

export const TEMPLATE_META = {
  blank: { label: "Blank", hint: "Start from an empty README", color: "#94a3b8", glyph: "∅" },
  web: { label: "Web", hint: "HTML, CSS & JS with live preview", color: "#fb923c", glyph: "<>" },
  javascript: { label: "JavaScript", hint: "Multi-file ES modules", color: "#facc15", glyph: "JS" },
  typescript: { label: "TypeScript", hint: "Typed modules, runs in-browser", color: "#60a5fa", glyph: "TS" },
  python: { label: "Python", hint: "Packages & imports via Pyodide", color: "#4ade80", glyph: "PY" },
};
