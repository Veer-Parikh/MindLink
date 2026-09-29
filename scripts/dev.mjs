/**
 * Runs the API server and the Vite dev server together with prefixed, coloured output.
 * Usage: npm run dev   (then open http://localhost:5173)
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

for (const dir of ["server", "client"]) {
  if (!fs.existsSync(path.join(root, dir, "node_modules"))) {
    console.error(`\n  ${dir}/node_modules is missing — run "npm run setup" first.\n`);
    process.exit(1);
  }
}

const procs = [
  { name: "server", color: "\x1b[36m", cwd: path.join(root, "server") },
  { name: "client", color: "\x1b[35m", cwd: path.join(root, "client") },
].map(({ name, color, cwd }) => {
  const child = spawn("npm", ["run", "dev"], { cwd, shell: true, env: { ...process.env, FORCE_COLOR: "1" } });
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) out.write(`${prefix}${line}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    console.log(`${prefix}exited with code ${code}`);
    shutdown(code ?? 0);
  });
  return child;
});

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of procs) {
    if (child.exitCode === null) {
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else child.kill("SIGINT");
    }
  }
  setTimeout(() => process.exit(code), 500);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
