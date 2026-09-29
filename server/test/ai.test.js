/**
 * AI routes against a stub Gemini API (GEMINI_BASE_URL), so the request shape and the
 * response/stream handling are verified without a real key or any cost.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mindlink-ai-"));
const port = 4900 + Math.floor(Math.random() * 90);
const base = `http://localhost:${port}`;
const requests = [];
let server;
let mock;
let mockPort;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidate = (text) => ({
  candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
});

function startMock() {
  return new Promise((resolve) => {
    mock = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const json = JSON.parse(body || "{}");
        requests.push({ url: req.url, headers: req.headers, body: json });
        if (req.url.includes(":streamGenerateContent")) {
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          for (const chunk of ["This file ", "prints a ", "greeting."])
            res.write(`data: ${JSON.stringify(candidate(chunk))}\r\n\r\n`);
          res.end();
          return;
        }
        const system = JSON.stringify(json.systemInstruction ?? json.system_instruction ?? "");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify(
            candidate(system.includes("commit") ? "Add greeting to index.js" : "- Ada added a greeting in `index.js`."),
          ),
        );
      });
    });
    mock.listen(0, () => {
      mockPort = mock.address().port;
      resolve();
    });
  });
}

async function api(method, url, { token, body } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

before(async () => {
  await startMock();
  server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/index.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_FILE: path.join(tmp, "ai.db"),
      JWT_SECRET: "test",
      GEMINI_API_KEY: "test-gemini-key",
      GOOGLE_API_KEY: "",
      GEMINI_MODEL: "gemini-flash-latest",
      GEMINI_BASE_URL: `http://localhost:${mockPort}`,
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  for (let i = 0; i < 200; i++) {
    if (
      await fetch(`${base}/api/meta`)
        .then((r) => r.ok)
        .catch(() => false)
    )
      return;
    await sleep(100);
  }
  throw new Error("server did not start");
});

after(() => {
  server?.kill();
  mock?.close();
  setTimeout(() => process.exit(), 200).unref();
});

test("AI routes send well-formed Gemini requests and relay the answers", async () => {
  const meta = await api("GET", "/api/meta");
  assert.equal(meta.data.ai, true);

  const { data: auth } = await api("POST", "/api/auth/register", {
    body: { name: "Ada", email: "ada@ai.test", password: "secret1" },
  });
  const token = auth.token;
  const { data: created } = await api("POST", "/api/projects", { token, body: { name: "AI", template: "javascript" } });
  const id = created.project.id;

  // Nothing changed yet → no model call.
  const none = await api("POST", `/api/projects/${id}/ai/commit-message`, { token });
  assert.equal(none.data.source, "none");
  assert.equal(requests.length, 0);

  // Edit a file over the realtime connection, like the browser does.
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(`ws://localhost:${port}/collab`, id, doc, { params: { token }, disableBc: true });
  await new Promise((r) => provider.once("sync", r));
  for (const [fid, node] of doc.getMap("tree")) {
    if (node.name === "index.js") doc.getMap("content").get(fid).insert(0, "console.log('hi');\n");
  }
  await sleep(300);

  const commit = await api("POST", `/api/projects/${id}/ai/commit-message`, { token });
  assert.equal(commit.status, 200);
  assert.equal(commit.data.source, "ai");
  assert.equal(commit.data.message, "Add greeting to index.js");
  const commitReq = requests.at(-1);
  assert.match(commitReq.url, /models\/gemini-flash-latest:generateContent/);
  assert.equal(commitReq.headers["x-goog-api-key"], "test-gemini-key");
  assert.match(JSON.stringify(commitReq.body.contents), /console\.log\('hi'\)/, "the diff is sent");

  // Streaming Pair answer arrives as SSE text events.
  const res = await fetch(`${base}/api/projects/${id}/ai/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello!" },
        { role: "user", content: "What does this do?" },
      ],
      context: {},
    }),
  });
  assert.equal(res.status, 200);
  const events = (await res.text())
    .split("\n\n")
    .filter((c) => c.startsWith("data: "))
    .map((c) => JSON.parse(c.slice(6)));
  assert.equal(
    events
      .filter((e) => e.type === "text")
      .map((e) => e.text)
      .join(""),
    "This file prints a greeting.",
  );
  assert.equal(events.at(-1).type, "done");
  const pairReq = requests.at(-1);
  assert.match(pairReq.url, /:streamGenerateContent/);
  assert.deepEqual(
    pairReq.body.contents.map((c) => c.role),
    ["user", "model", "user"],
    "assistant turns are sent with Gemini's 'model' role",
  );
  assert.match(JSON.stringify(pairReq.body.systemInstruction ?? pairReq.body.system_instruction), /Project files:/);

  provider.destroy();
  doc.destroy();
});
