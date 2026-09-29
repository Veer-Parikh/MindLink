import { Router } from "express";
import { config } from "../config.js";
import { HttpError, requireAuth } from "../auth.js";

/**
 * Remote execution through a Piston instance, for languages the browser can't run itself.
 * JavaScript, TypeScript, Python and HTML run client-side and never hit this route.
 */
const router = Router();
router.use(requireAuth);

let runtimeCache = null;

async function piston(path, init) {
  if (!config.pistonUrl) throw new HttpError(501, "Remote execution isn't configured. Set PISTON_URL in server/.env.");
  const res = await fetch(`${config.pistonUrl}/api/v2${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, body.message || `Runner responded with ${res.status}.`);
  return body;
}

router.get("/runtimes", async (_req, res) => {
  if (!config.pistonUrl) return res.json({ runtimes: [] });
  runtimeCache ??= await piston("/runtimes");
  res.json({ runtimes: runtimeCache });
});

router.post("/", async (req, res) => {
  const { language, files, stdin } = req.body ?? {};
  if (!language || !Array.isArray(files) || files.length === 0) throw new HttpError(400, "Nothing to run.");
  const started = Date.now();
  const result = await piston("/execute", {
    method: "POST",
    body: JSON.stringify({
      language,
      version: "*",
      files: files.slice(0, 50).map((f) => ({ name: String(f.name), content: String(f.content ?? "") })),
      stdin: String(stdin ?? ""),
      run_timeout: 10_000,
    }),
  });
  const compile = result.compile && result.compile.code !== 0 ? result.compile.output : "";
  res.json({
    output: (compile || "") + (result.run?.output ?? ""),
    ok: !compile && result.run?.code === 0,
    exitCode: result.run?.code ?? null,
    ms: Date.now() - started,
  });
});

export default router;
