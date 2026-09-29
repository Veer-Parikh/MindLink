/**
 * AI features, powered by the Gemini API (free tier friendly). Everything here is optional: without
 * GEMINI_API_KEY the checkpoint suggestions fall back to a heuristic and Pair explains how to enable itself.
 */
import { Router } from "express";
import { ApiError, GoogleGenAI } from "@google/genai";
import { createTwoFilesPatch } from "diff";
import { db } from "../db.js";
import { config } from "../config.js";
import { HttpError, requireAuth, requireRole } from "../auth.js";
import { getDoc } from "../collab/docs.js";
import { exportFiles } from "../collab/model.js";
import { computeCatchup } from "./workspace.js";

const router = Router({ mergeParams: true });
router.use(requireAuth);

const MAX_DIFF_CHARS = 120_000;

let client = null;
function gemini() {
  if (!config.aiEnabled) return null;
  client ??= new GoogleGenAI({
    apiKey: config.geminiApiKey,
    ...(config.geminiBaseUrl ? { httpOptions: { baseUrl: config.geminiBaseUrl } } : {}),
  });
  return client;
}

/** Text of a non-streamed response, or a friendly error when Gemini blocked it. */
function textOf(response) {
  if (response.promptFeedback?.blockReason || response.candidates?.[0]?.finishReason === "SAFETY") {
    throw new HttpError(422, "Gemini declined this request.");
  }
  return (response.text ?? "").trim();
}

function toHttpError(err) {
  if (err instanceof HttpError) return err;
  if (err instanceof ApiError) {
    if (err.status === 400 && /API key/i.test(err.message))
      return new HttpError(502, "Gemini rejected the API key. Check GEMINI_API_KEY.");
    if (err.status === 401 || err.status === 403) return new HttpError(502, "Gemini rejected the API key. Check GEMINI_API_KEY.");
    if (err.status === 429) return new HttpError(429, "Gemini's free-tier rate limit was hit — try again in a minute.");
    if (err.status === 404) return new HttpError(502, `Gemini model “${config.geminiModel}” wasn't found. Check GEMINI_MODEL.`);
    return new HttpError(502, `Gemini request failed (${err.status}).`);
  }
  return err;
}

/** Unified diff of every file that differs between two exported file lists. */
function projectDiff(beforeFiles, afterFiles) {
  const before = new Map(beforeFiles.filter((f) => f.type === "file").map((f) => [f.id, f]));
  const patches = [];
  for (const f of afterFiles) {
    if (f.type !== "file") continue;
    const prev = before.get(f.id);
    before.delete(f.id);
    if (prev && prev.content === f.content && prev.path === f.path) continue;
    patches.push(
      createTwoFilesPatch(prev ? prev.path : "/dev/null", f.path, prev?.content ?? "", f.content ?? "", "", "", { context: 2 }),
    );
  }
  for (const gone of before.values())
    patches.push(createTwoFilesPatch(gone.path, "/dev/null", gone.content ?? "", "", "", "", { context: 0 }));
  let diff = patches.join("\n");
  let truncated = false;
  if (diff.length > MAX_DIFF_CHARS) {
    diff = diff.slice(0, MAX_DIFF_CHARS);
    truncated = true;
  }
  return { diff, truncated, changedCount: patches.length };
}

const lastCheckpointStmt = db.prepare(`
  SELECT files FROM snapshots WHERE project_id = ? AND kind IN ('checkpoint', 'initial', 'restore')
  ORDER BY id DESC LIMIT 1
`);

function heuristicMessage(beforeFiles, afterFiles) {
  const before = new Map(beforeFiles.filter((f) => f.type === "file").map((f) => [f.id, f]));
  const added = [];
  const changed = [];
  for (const f of afterFiles) {
    if (f.type !== "file") continue;
    const prev = before.get(f.id);
    before.delete(f.id);
    if (!prev) added.push(f.name);
    else if (prev.content !== f.content || prev.path !== f.path) changed.push(f.name);
  }
  const removed = Array.from(before.values()).map((f) => f.name);
  const list = (names) => (names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} +${names.length - 2} more`);
  const parts = [];
  if (changed.length) parts.push(`Update ${list(changed)}`);
  if (added.length) parts.push(`${parts.length ? "add" : "Add"} ${list(added)}`);
  if (removed.length) parts.push(`${parts.length ? "remove" : "Remove"} ${list(removed)}`);
  return parts.join(", ") || "Save progress";
}

router.post("/commit-message", requireRole("editor"), async (req, res) => {
  const current = exportFiles(getDoc(req.project.id));
  const baseRow = lastCheckpointStmt.get(req.project.id);
  const base = baseRow ? JSON.parse(baseRow.files) : [];
  const { diff, truncated, changedCount } = projectDiff(base, current);
  if (changedCount === 0) return res.json({ message: "", source: "none", note: "Nothing changed since the last checkpoint." });

  const ai = gemini();
  if (!ai) return res.json({ message: heuristicMessage(base, current), source: "heuristic" });
  try {
    const response = await ai.models.generateContent({
      model: config.geminiModel,
      contents: `Project diff since the last checkpoint${truncated ? " (truncated — it continues beyond this point)" : ""}:\n\n${diff}`,
      config: {
        systemInstruction:
          "You write git-style commit messages. Reply with a single imperative line under 72 characters " +
          "describing the most important change. No quotes, no trailing period, no prefix like 'feat:'.",
        temperature: 0.3,
      },
    });
    const message = textOf(response)
      .split("\n")[0]
      .replace(/^["'`*]+|["'`.*]+$/g, "")
      .slice(0, 120);
    res.json({ message: message || heuristicMessage(base, current), source: "ai" });
  } catch (err) {
    throw toHttpError(err);
  }
});

router.post("/catchup", requireRole("viewer"), async (req, res) => {
  const catchup = computeCatchup(req.project, req.user.id);
  if (!catchup.files || catchup.changes.length === 0) return res.json({ summary: null });
  const ai = gemini();
  if (!ai) return res.json({ summary: null, source: "none" });
  const { diff, truncated } = projectDiff(catchup.files.baseline, catchup.files.current);
  const who = catchup.authors.map((a) => a.name).join(", ") || "teammates";
  const checkpoints = catchup.checkpoints.map((c) => `- ${c.message} (${c.by ?? "someone"})`).join("\n") || "(none)";
  try {
    const response = await ai.models.generateContent({
      model: config.geminiModel,
      contents:
        `Changes by ${who}.\nCheckpoints created meanwhile:\n${checkpoints}\n\n` +
        `Diff${truncated ? " (truncated)" : ""}:\n${diff}`,
      config: {
        systemInstruction:
          "You brief a developer returning to a shared codebase about what their teammates changed while they were away. " +
          "Write 2–4 short markdown bullet points, most important first, referencing files in backticks. " +
          "Focus on behaviour and intent rather than line counts. No heading, no preamble.",
        temperature: 0.4,
      },
    });
    res.json({ summary: textOf(response), source: "ai" });
  } catch (err) {
    throw toHttpError(err);
  }
});

/**
 * Pair: a streaming coding assistant that sees the file you're in (and, optionally, the rest of the project).
 * Responds with server-sent events: {type:"text", text} … {type:"done"} | {type:"error", message}.
 */
router.post("/pair", requireRole("viewer"), async (req, res) => {
  const ai = gemini();
  if (!ai) throw new HttpError(503, "AI is not configured on this server. Add GEMINI_API_KEY to server/.env to enable Pair.");

  const history = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const messages = history
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-20);
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    throw new HttpError(400, "Ask a question first.");
  }
  const contents = messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));

  const ctx = req.body?.context ?? {};
  const files = exportFiles(getDoc(req.project.id)).filter((f) => f.type === "file");
  const active = files.find((f) => f.id === ctx.fileId);
  const others = ctx.includeProject
    ? files
        .filter((f) => f.id !== ctx.fileId)
        .map((f) => `<file path="${f.path}">\n${f.content}\n</file>`)
        .join("\n")
    : files.map((f) => f.path).join("\n");

  const systemInstruction = [
    "You are Pair, the AI teammate inside MindLink, a realtime collaborative code editor.",
    "Answer concisely in markdown. When proposing code, use fenced code blocks with a language tag;",
    "prefer showing only the changed region unless the user asks for the whole file.",
    `Project: ${req.project.name}.`,
    ctx.includeProject ? `All project files:\n${others}` : `Project files:\n${others}`,
    active
      ? `The user is looking at \`${active.path}\`:\n<active_file path="${active.path}">\n${active.content}\n</active_file>`
      : "",
    ctx.selection ? `They have selected:\n<selection>\n${String(ctx.selection)}\n</selection>` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const emit = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  // Stop generating if the browser goes away. (`req` "close" fires as soon as the body is read, so watch `res`.)
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) abort.abort();
  });

  try {
    const stream = await ai.models.generateContentStream({
      model: config.geminiModel,
      contents,
      config: { systemInstruction, abortSignal: abort.signal },
    });
    let blocked = false;
    for await (const chunk of stream) {
      if (chunk.promptFeedback?.blockReason || chunk.candidates?.[0]?.finishReason === "SAFETY") blocked = true;
      const text = chunk.text;
      if (text) emit({ type: "text", text });
    }
    emit(blocked ? { type: "error", message: "Gemini declined to answer that." } : { type: "done" });
  } catch (err) {
    if (!abort.signal.aborted && !res.writableEnded) emit({ type: "error", message: toHttpError(err).message });
  } finally {
    res.end();
  }
});

export default router;
