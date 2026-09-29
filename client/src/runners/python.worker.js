/**
 * Runs Python projects with Pyodide (CPython compiled to WebAssembly).
 * The interpreter stays warm between runs; project files are written into a virtual FS so imports work,
 * and packages like numpy are fetched on demand from the Pyodide CDN.
 */
const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.29.5/full/";

const ROOT = "/home/pyodide/project";
let pyodideReady = null;

/** Drops Pyodide/runpy frames from a traceback and shows project-relative paths. */
function cleanTraceback(message) {
  const out = [];
  let skipping = false;
  for (const l of message.split("\n")) {
    if (/^\s{2}File "/.test(l)) {
      skipping = !l.includes(ROOT);
      if (skipping) continue;
    } else if (skipping && /^\s{4}/.test(l)) {
      continue;
    } else {
      skipping = false;
    }
    out.push(l.replaceAll(`${ROOT}/`, ""));
  }
  return out.join("\n").trim();
}
const post = (type, payload) => self.postMessage({ type, ...payload });

async function boot() {
  post("status", { text: "Loading Python runtime (first run only)…" });
  const { loadPyodide } = await import(/* @vite-ignore */ `${PYODIDE_URL}pyodide.mjs`);
  const pyodide = await loadPyodide({ indexURL: PYODIDE_URL });
  return pyodide;
}

self.onmessage = async ({ data }) => {
  const { files, entry, stdin = "" } = data;
  const started = performance.now();
  try {
    pyodideReady ??= boot().catch((err) => {
      pyodideReady = null; // allow a retry once the network is back
      throw new Error(`Couldn't load the Python runtime (${err.message}). Check your internet connection and try again.`);
    });
    const pyodide = await pyodideReady;

    pyodide.setStdout({ batched: (text) => post("line", { stream: "stdout", text }) });
    pyodide.setStderr({ batched: (text) => post("line", { stream: "stderr", text }) });
    const stdinLines = stdin.split("\n");
    let stdinIndex = 0;
    pyodide.setStdin({ stdin: () => (stdinIndex < stdinLines.length ? stdinLines[stdinIndex++] : undefined) });

    const root = ROOT;
    pyodide.runPython(`
import os, shutil, sys
root = ${JSON.stringify(root)}
if os.path.exists(root):
    shutil.rmtree(root)
os.makedirs(root)
`);
    for (const f of files) {
      const full = `${root}/${f.path}`;
      const dir = full.slice(0, full.lastIndexOf("/"));
      pyodide.FS.mkdirTree(dir);
      pyodide.FS.writeFile(full, f.content ?? "");
    }

    const allSource = files
      .filter((f) => f.path.endsWith(".py"))
      .map((f) => f.content)
      .join("\n");
    await pyodide.loadPackagesFromImports(allSource, {
      messageCallback: (msg) => post("status", { text: msg }),
      errorCallback: (msg) => post("line", { stream: "stderr", text: msg }),
    });

    pyodide.globals.set("__ml_entry", `${root}/${entry}`);
    pyodide.globals.set("__ml_root", root);
    await pyodide.runPythonAsync(`
import sys, os, runpy, importlib
os.chdir(__ml_root)
if __ml_root not in sys.path:
    sys.path.insert(0, __ml_root)
# Forget project modules from the previous run so edits are picked up.
for name, mod in list(sys.modules.items()):
    f = getattr(mod, "__file__", None) or ""
    if f.startswith(__ml_root):
        del sys.modules[name]
importlib.invalidate_caches()
runpy.run_path(__ml_entry, run_name="__main__")
`);
    post("done", { ok: true, ms: performance.now() - started });
  } catch (err) {
    post("line", { stream: "stderr", text: cleanTraceback(String(err?.message ?? err)) });
    post("done", { ok: false, ms: performance.now() - started });
  }
};
