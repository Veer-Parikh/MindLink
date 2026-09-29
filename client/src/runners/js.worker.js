/**
 * Runs a JavaScript/TypeScript project inside a Web Worker.
 * Every project file is transpiled (Sucrase: ESM → CommonJS, TS/JSX stripped) and wired together with a
 * tiny `require`, so multi-file projects with relative imports just work.
 */
import { transform } from "sucrase";

const post = (type, payload) => self.postMessage({ type, ...payload });

function format(value, depth = 0) {
  if (typeof value === "string") return depth === 0 ? value : JSON.stringify(value);
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  if (typeof value === "symbol" || typeof value === "bigint") return String(value);
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return String(value);
  if (depth > 3) return Array.isArray(value) ? "[Array]" : "[Object]";
  if (value instanceof Map)
    return `Map(${value.size}) {${[...value].map(([k, v]) => ` ${format(k, depth + 1)} => ${format(v, depth + 1)}`).join(",")} }`;
  if (value instanceof Set) return `Set(${value.size}) {${[...value].map((v) => ` ${format(v, depth + 1)}`).join(",")} }`;
  if (Array.isArray(value)) return `[ ${value.map((v) => format(v, depth + 1)).join(", ")} ]`;
  try {
    const entries = Object.entries(value).map(
      ([k, v]) => `${/^[a-z_$][\w$]*$/i.test(k) ? k : JSON.stringify(k)}: ${format(v, depth + 1)}`,
    );
    return entries.length ? `{ ${entries.join(", ")} }` : "{}";
  } catch {
    return String(value);
  }
}

const line =
  (stream) =>
  (...args) =>
    post("line", { stream, text: args.map((a) => format(a)).join(" ") });
const counters = new Map();
const timers = new Map();
const consoleShim = {
  log: line("stdout"),
  info: line("stdout"),
  debug: line("stdout"),
  warn: line("stderr"),
  error: line("stderr"),
  table: (data) => line("stdout")(format(data)),
  dir: (v) => line("stdout")(format(v)),
  count: (label = "default") => {
    counters.set(label, (counters.get(label) ?? 0) + 1);
    line("stdout")(`${label}: ${counters.get(label)}`);
  },
  time: (label = "default") => timers.set(label, performance.now()),
  timeEnd: (label = "default") =>
    line("stdout")(`${label}: ${(performance.now() - (timers.get(label) ?? performance.now())).toFixed(2)}ms`),
  assert: (cond, ...args) => !cond && line("stderr")("Assertion failed:", ...args),
  clear: () => {},
  group: line("stdout"),
  groupEnd: () => {},
};

function normalize(path) {
  const out = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

const dirname = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const EXTS = ["", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx", ".json", "/index.ts", "/index.js"];

self.onmessage = async ({ data }) => {
  const { files, entry } = data;
  const sources = new Map(files.map((f) => [f.path, f.content]));
  const cache = new Map();

  const resolve = (from, request) => {
    const base = request.startsWith("/") ? normalize(request) : normalize(`${dirname(from)}/${request}`);
    for (const ext of EXTS) {
      if (sources.has(base + ext)) return base + ext;
    }
    // TS projects often import "./x.js" meaning "./x.ts".
    const stripped = base.replace(/\.(m?js|jsx)$/, "");
    for (const ext of [".ts", ".tsx"]) if (sources.has(stripped + ext)) return stripped + ext;
    return null;
  };

  const load = (path) => {
    if (cache.has(path)) return cache.get(path).exports;
    const module = { exports: {} };
    cache.set(path, module);
    const source = sources.get(path);
    if (path.endsWith(".json")) {
      module.exports = JSON.parse(source);
      return module.exports;
    }
    const transforms = ["imports"];
    if (/\.tsx?$/.test(path)) transforms.push("typescript");
    if (/\.[jt]sx$/.test(path)) transforms.push("jsx");
    const { code } = transform(source, { transforms, filePath: path, production: true });
    const localRequire = (request) => {
      if (!request.startsWith(".") && !request.startsWith("/")) {
        throw new Error(`Cannot import "${request}": packages aren't available in the browser runner — only project files.`);
      }
      const resolved = resolve(path, request);
      if (!resolved) throw new Error(`Cannot find module "${request}" from ${path}`);
      return load(resolved);
    };
    const fn = new Function(
      "require",
      "module",
      "exports",
      "console",
      "__filename",
      "__dirname",
      `${code}\n//# sourceURL=mindlink://${path}`,
    );
    fn(localRequire, module, module.exports, consoleShim, path, dirname(path));
    return module.exports;
  };

  self.console = consoleShim;
  const started = performance.now();
  try {
    const exported = load(entry);
    // Wait for top-level promises (e.g. an exported async main) and pending timers to flush.
    if (exported && typeof exported.then === "function") await exported;
    await new Promise((r) => setTimeout(r, 30));
    post("done", { ok: true, ms: performance.now() - started });
  } catch (err) {
    post("line", {
      stream: "stderr",
      text:
        err && err.stack
          ? String(err.stack)
              .split("\n")
              .filter((l) => !l.includes("js.worker"))
              .join("\n")
          : String(err),
    });
    post("done", { ok: false, ms: performance.now() - started });
  }
};

self.addEventListener("unhandledrejection", (e) => {
  post("line", { stream: "stderr", text: `Unhandled promise rejection: ${format(e.reason)}` });
});
