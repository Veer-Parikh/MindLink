import { api } from "../lib/api.js";
import { languageFor } from "../lib/languages.js";

const TIMEOUT_MS = { js: 10_000, ts: 10_000, python: 30_000 };

let pythonWorker = null;
let activeStop = null;

/** How (and whether) a file can be run. */
export function runInfo(fileName, meta) {
  const lang = languageFor(fileName);
  switch (lang.runner) {
    case "js":
    case "ts":
      return { kind: lang.runner, label: lang.label, where: "browser" };
    case "python":
      return { kind: "python", label: "Python", where: "browser" };
    case "html":
      return { kind: "html", label: "Preview", where: "preview" };
    case "piston":
      return meta?.remoteRun
        ? { kind: "piston", label: lang.label, where: "server", piston: lang.piston }
        : {
            kind: "unavailable",
            label: lang.label,
            reason: `${lang.label} needs a remote runner — set PISTON_URL on the server.`,
          };
    default:
      return { kind: "unavailable", label: lang.label, reason: `${lang.label} files can't be run.` };
  }
}

export function stopRun() {
  activeStop?.();
}

function runInWorker(createWorker, { files, entry, stdin, onLine, onStatus, timeout, keepAlive }) {
  return new Promise((resolve) => {
    const worker = createWorker();
    let finished = false;
    const finish = (result, { kill = !keepAlive } = {}) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      activeStop = null;
      worker.onmessage = null;
      if (kill) {
        worker.terminate();
        if (worker === pythonWorker) pythonWorker = null;
      }
      resolve(result);
    };
    const started = performance.now();
    const timer = setTimeout(() => {
      onLine({ stream: "stderr", text: `\n⏱ Stopped after ${timeout / 1000}s — is there an infinite loop?` });
      finish({ ok: false, ms: performance.now() - started, timedOut: true }, { kill: true });
    }, timeout);
    activeStop = () => {
      onLine({ stream: "stderr", text: "\n■ Stopped." });
      finish({ ok: false, ms: performance.now() - started, stopped: true }, { kill: true });
    };
    worker.onmessage = ({ data }) => {
      if (data.type === "line") onLine({ stream: data.stream, text: data.text });
      else if (data.type === "status") onStatus?.(data.text);
      else if (data.type === "done") finish({ ok: data.ok, ms: data.ms });
    };
    worker.onerror = (e) => {
      onLine({ stream: "stderr", text: e.message || "The runner crashed." });
      finish({ ok: false, ms: performance.now() - started }, { kill: true });
    };
    worker.postMessage({ files, entry, stdin });
  });
}

/**
 * Runs `entry` with the whole project available for imports.
 * Streams output through onLine({ stream: "stdout" | "stderr" | "system", text }).
 */
export async function runProject({ files, entry, stdin = "", meta, onLine, onStatus }) {
  const info = runInfo(entry, meta);
  const sourceFiles = files.filter((f) => f.type === "file").map((f) => ({ path: f.path, content: f.content ?? "" }));

  if (info.kind === "js" || info.kind === "ts") {
    return runInWorker(() => new Worker(new URL("./js.worker.js", import.meta.url), { type: "module" }), {
      files: sourceFiles,
      entry,
      stdin,
      onLine,
      onStatus,
      timeout: TIMEOUT_MS.js,
    });
  }
  if (info.kind === "python") {
    pythonWorker ??= new Worker(new URL("./python.worker.js", import.meta.url), { type: "module" });
    const worker = pythonWorker;
    return runInWorker(() => worker, {
      files: sourceFiles,
      entry,
      stdin,
      onLine,
      onStatus,
      timeout: TIMEOUT_MS.python,
      keepAlive: true,
    });
  }
  if (info.kind === "piston") {
    const entryFile = sourceFiles.find((f) => f.path === entry);
    const others = sourceFiles.filter((f) => f.path !== entry && languageFor(f.path).piston === info.piston);
    onStatus?.("Running on the server…");
    try {
      const result = await api("/run", {
        method: "POST",
        body: { language: info.piston, stdin, files: [entryFile, ...others].map((f) => ({ name: f.path, content: f.content })) },
      });
      for (const text of result.output.replace(/\n$/, "").split("\n")) onLine({ stream: result.ok ? "stdout" : "stderr", text });
      return { ok: result.ok, ms: result.ms };
    } catch (err) {
      onLine({ stream: "stderr", text: err.message });
      return { ok: false, ms: 0 };
    }
  }
  onLine({ stream: "stderr", text: info.reason ?? "This file can't be run." });
  return { ok: false, ms: 0 };
}

// ───────────────────────────── HTML preview ─────────────────────────────

const CONSOLE_BRIDGE = `<script>(function(){
  var send=function(level,args){try{parent.postMessage({__mindlink:true,level:level,text:Array.prototype.map.call(args,function(a){
    if(typeof a==="string")return a;if(a instanceof Error)return a.stack||a.message;try{return JSON.stringify(a)}catch(e){return String(a)}}).join(" ")},"*")}catch(e){}};
  ["log","info","warn","error","debug"].forEach(function(k){var o=console[k];console[k]=function(){send(k,arguments);o&&o.apply(console,arguments)}});
  addEventListener("error",function(e){send("error",[e.message+(e.lineno?" (line "+e.lineno+")":"")])});
  addEventListener("unhandledrejection",function(e){send("error",["Unhandled rejection: "+(e.reason&&e.reason.message||e.reason)])});
})();</script>`;

function resolveRelative(fromPath, ref) {
  if (/^(https?:|data:|\/\/|#|mailto:)/i.test(ref)) return null;
  const baseDir = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")).split("/") : [];
  const parts = ref.startsWith("/") ? [] : [...baseDir];
  for (const seg of ref.split(/[?#]/)[0].split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

const escapeScript = (code) => code.replace(/<\/script/gi, "<\\/script");

/** Builds a self-contained srcdoc for an HTML file, inlining project CSS/JS it references. */
export function buildPreview(files, htmlPath) {
  const byPath = new Map(files.filter((f) => f.type === "file").map((f) => [f.path, f.content ?? ""]));
  let html = byPath.get(htmlPath);
  if (html == null) return "<p style='font-family:sans-serif;color:#888'>File not found.</p>";

  html = html.replace(/<link\b([^>]*?)href=["']([^"']+)["']([^>]*)>/gi, (match, pre, href, post) => {
    if (!/stylesheet/i.test(pre + post)) return match;
    const path = resolveRelative(htmlPath, href);
    return path && byPath.has(path) ? `<style data-file="${path}">\n${byPath.get(path)}\n</style>` : match;
  });
  html = html.replace(/<script\b([^>]*?)src=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (match, pre, src, post) => {
    const path = resolveRelative(htmlPath, src);
    if (!path || !byPath.has(path)) return match;
    const attrs = `${pre} ${post}`.replace(/\s+/g, " ").trim();
    return `<script ${attrs} data-file="${path}">\n${escapeScript(byPath.get(path))}\n</script>`;
  });

  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${CONSOLE_BRIDGE}`);
  return CONSOLE_BRIDGE + html;
}
