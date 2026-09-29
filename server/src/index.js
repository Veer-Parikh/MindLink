import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { HttpError } from "./auth.js";
import { attachCollabServer } from "./collab/ws.js";
import { flushAll } from "./collab/docs.js";
import authRoutes from "./routes/auth.js";
import projectRoutes from "./routes/projects.js";
import workspaceRoutes from "./routes/workspace.js";
import aiRoutes from "./routes/ai.js";
import runRoutes from "./routes/run.js";

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: config.clientOrigins, credentials: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/meta", (_req, res) => {
  res.json({ ai: config.aiEnabled, remoteRun: Boolean(config.pistonUrl), version: "2.0.0" });
});
app.use("/api/auth", authRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/projects/:projectId", workspaceRoutes);
app.use("/api/projects/:projectId/ai", aiRoutes);
app.use("/api/run", runRoutes);
app.use("/api", (_req, _res, next) => next(new HttpError(404, "Not found.")));

// In production the built client is served from the same origin.
if (fs.existsSync(path.join(config.clientDist, "index.html"))) {
  app.use(express.static(config.clientDist, { index: false, maxAge: "1h" }));
  app.get(/^(?!\/api|\/collab).*/, (_req, res) => res.sendFile(path.join(config.clientDist, "index.html")));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err instanceof HttpError ? err.status : err.type === "entity.parse.failed" ? 400 : 500;
  if (!(err instanceof HttpError) && status >= 500) console.error(err);
  res
    .status(status)
    .json({ error: status >= 500 && !(err instanceof HttpError) ? "Something went wrong on our side." : err.message });
});

const server = http.createServer(app);
attachCollabServer(server);

server.listen(config.port, () => {
  console.log(`\n  ◆ MindLink server ready on http://localhost:${config.port}`);
  console.log(`    AI features: ${config.aiEnabled ? `on (Gemini · ${config.geminiModel})` : "off (set GEMINI_API_KEY to enable)"}`);
  console.log(`    Remote runner: ${config.pistonUrl || "off (JS/TS/Python/HTML run in the browser)"}\n`);
});

function shutdown() {
  console.log("\n  Saving open projects…");
  flushAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
