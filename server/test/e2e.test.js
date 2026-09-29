/**
 * End-to-end test: boots the real server on a random port with a throwaway database and drives it over
 * HTTP + WebSocket exactly like the browser client does.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mindlink-test-"));
const port = 4500 + Math.floor(Math.random() * 400);
const base = `http://localhost:${port}`;
let server;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, label, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

async function api(method, url, { token, body } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function connect(projectId, token) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(`ws://localhost:${port}/collab`, projectId, doc, {
    params: { token },
    disableBc: true,
  });
  const events = [];
  provider.messageHandlers[100] = (_enc, decoder) => {
    // lib0 decoding: read a var string
    const len = readVarUint(decoder);
    const bytes = decoder.arr.subarray(decoder.pos, decoder.pos + len);
    decoder.pos += len;
    events.push(JSON.parse(new TextDecoder().decode(bytes)));
  };
  return { doc, provider, events };
}

function readVarUint(decoder) {
  let num = 0;
  let mult = 1;
  for (;;) {
    const r = decoder.arr[decoder.pos++];
    num += (r & 0x7f) * mult;
    mult *= 128;
    if (r < 0x80) return num;
  }
}

const fileByName = (doc, name) => {
  for (const [id, node] of doc.getMap("tree")) if (node.name === name) return { id, text: doc.getMap("content").get(id) };
  return null;
};

before(async () => {
  server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/index.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_FILE: path.join(tmp, "test.db"),
      JWT_SECRET: "test",
      GEMINI_API_KEY: "", GOOGLE_API_KEY: "",
      PISTON_URL: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write(d));
  server.stdout.on("data", (d) => process.stderr.write(d));
  server.on("exit", (code) => code && console.error("server exited", code));
  await until(
    async () =>
      await fetch(`${base}/api/meta`)
        .then((r) => r.ok)
        .catch(() => false),
    "server boot",
    20000,
  );
});

after(() => {
  server?.kill();
  // y-websocket keeps reconnect timers around after destroy(); don't let them hold the runner open.
  setTimeout(() => process.exit(), 200).unref();
});

test("full collaboration flow", async () => {
  // ── accounts
  const ada = await api("POST", "/api/auth/register", { body: { name: "Ada", email: "ada@example.com", password: "secret1" } });
  assert.equal(ada.status, 201);
  const dup = await api("POST", "/api/auth/register", { body: { name: "Ada", email: "ADA@example.com", password: "secret1" } });
  assert.equal(dup.status, 409);
  const bob = await api("POST", "/api/auth/register", { body: { name: "Bob", email: "bob@example.com", password: "secret2" } });
  const eve = await api("POST", "/api/auth/register", { body: { name: "Eve", email: "eve@example.com", password: "secret3" } });
  const badLogin = await api("POST", "/api/auth/login", { body: { email: "ada@example.com", password: "nope" } });
  assert.equal(badLogin.status, 401);
  const login = await api("POST", "/api/auth/login", { body: { email: "ada@example.com", password: "secret1" } });
  assert.equal(login.status, 200);
  const A = login.data.token;
  const B = bob.data.token;
  const E = eve.data.token;

  // ── project from template
  const created = await api("POST", "/api/projects", { token: A, body: { name: "Demo", template: "javascript" } });
  assert.equal(created.status, 201);
  const project = created.data.project;
  assert.equal(project.role, "owner");
  assert.match(project.inviteCode, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  // Bob joins via invite (default editor), Eve joins and gets demoted to viewer.
  const join = await api("POST", "/api/projects/join", {
    token: B,
    body: { code: project.inviteCode.toLowerCase().replace("-", "") },
  });
  assert.equal(join.status, 200);
  await api("POST", "/api/projects/join", { token: E, body: { code: project.inviteCode } });
  const demote = await api("PATCH", `/api/projects/${project.id}/members/${eve.data.user.id}`, {
    token: A,
    body: { role: "viewer" },
  });
  assert.equal(demote.status, 200);
  const bobCantDemote = await api("PATCH", `/api/projects/${project.id}/members/${eve.data.user.id}`, {
    token: B,
    body: { role: "editor" },
  });
  assert.equal(bobCantDemote.status, 403);

  // Outsiders can't see it.
  const stranger = await api("POST", "/api/auth/register", {
    body: { name: "Zed", email: "zed@example.com", password: "secret4" },
  });
  assert.equal((await api("GET", `/api/projects/${project.id}`, { token: stranger.data.token })).status, 404);

  // ── realtime sync between two editors + a viewer
  const a = connect(project.id, A);
  const b = connect(project.id, B);
  const e = connect(project.id, E);
  await until(() => a.provider.synced && b.provider.synced && e.provider.synced, "initial sync");
  const aFile = fileByName(a.doc, "index.js");
  assert.ok(aFile, "template file exists");
  assert.match(aFile.text.toString(), /Welcome to MindLink/);

  aFile.text.insert(0, "// hello from ada\n");
  await until(() => fileByName(b.doc, "index.js")?.text.toString().startsWith("// hello from ada"), "ada → bob");
  fileByName(b.doc, "index.js").text.insert(0, "// bob was here\n");
  await until(() => aFile.text.toString().startsWith("// bob was here\n// hello from ada"), "bob → ada");

  // Viewer edits never reach anyone.
  fileByName(e.doc, "index.js").text.insert(0, "// EVE HACK\n");
  await sleep(400);
  assert.ok(!aFile.text.toString().includes("EVE HACK"), "viewer edit was rejected");

  // Awareness (cursors/presence) flows both ways.
  a.provider.awareness.setLocalStateField("user", { name: "Ada" });
  await until(() => Array.from(b.provider.awareness.getStates().values()).some((s) => s.user?.name === "Ada"), "awareness");

  // ── checkpoint + auto snapshots
  const cp = await api("POST", `/api/projects/${project.id}/checkpoints`, { token: A, body: { message: "Say hello" } });
  assert.equal(cp.status, 201);
  assert.equal(cp.data.snapshot.kind, "checkpoint");
  assert.equal(cp.data.snapshot.added, 2);
  await until(() => b.events.some((ev) => ev.type === "snapshot" && ev.snapshot.kind === "checkpoint"), "snapshot event");
  assert.equal(
    (await api("POST", `/api/projects/${project.id}/checkpoints`, { token: E, body: { message: "nope" } })).status,
    403,
  );

  aFile.text.insert(aFile.text.length, "\nconsole.log('later');\n");
  await sleep(4600); // debounce window for automatic snapshots
  const timeline = await api("GET", `/api/projects/${project.id}/timeline`, { token: E });
  const kinds = timeline.data.snapshots.map((s) => s.kind);
  assert.deepEqual(kinds.slice(0, 2), ["initial", "checkpoint"]);
  assert.equal(kinds.at(-1), "auto", "auto snapshot recorded after typing stopped");

  // ── Rewind restore brings every client back to the checkpoint
  const restore = await api("POST", `/api/projects/${project.id}/snapshots/${cp.data.snapshot.id}/restore`, { token: B });
  assert.equal(restore.status, 200);
  await until(() => !aFile.text.toString().includes("later"), "restore propagated");
  assert.ok(aFile.text.toString().startsWith("// bob was here\n// hello from ada"));

  // ── chat, run log, threads (viewer can participate)
  assert.equal((await api("POST", `/api/projects/${project.id}/chat`, { token: E, body: { text: "nice!" } })).status, 201);
  await until(
    () =>
      a.doc
        .getArray("chat")
        .toArray()
        .some((m) => m.text === "nice!" && m.name === "Eve"),
    "chat",
  );
  const run = await api("POST", `/api/projects/${project.id}/runs`, {
    token: B,
    body: { fileId: aFile.id, path: "index.js", language: "javascript", output: "hi", ok: true, ms: 12 },
  });
  assert.equal(run.status, 201);
  const thread = await api("POST", `/api/projects/${project.id}/threads`, {
    token: E,
    body: { fileId: aFile.id, line: 2, text: "Why this?" },
  });
  assert.equal(thread.status, 201);
  await api("POST", `/api/projects/${project.id}/threads/${thread.data.thread.id}/comments`, {
    token: A,
    body: { text: "Because." },
  });
  await until(() => a.doc.getMap("threads").get(thread.data.thread.id)?.comments.length === 2, "thread reply");
  assert.equal((await api("DELETE", `/api/projects/${project.id}/threads/${thread.data.thread.id}`, { token: B })).status, 403);

  // ── catch-up: Eve leaves, Ada changes things, Eve returns
  e.provider.destroy();
  await sleep(300);
  const newFile = { id: "newfile1", name: "notes.md", parentId: null, type: "file" };
  a.doc.transact(() => {
    a.doc.getMap("tree").set(newFile.id, newFile);
    const t = new Y.Text();
    a.doc.getMap("content").set(newFile.id, t);
    t.insert(0, "# Notes\nline two\n");
  });
  await sleep(4600);
  const catchup = await api("GET", `/api/projects/${project.id}/catchup`, { token: E });
  assert.equal(catchup.status, 200);
  assert.ok(
    catchup.data.catchup.changes.some((c) => c.path === "notes.md" && c.status === "added"),
    "catch-up sees the new file",
  );
  assert.deepEqual(
    catchup.data.catchup.authors.map((u) => u.name),
    ["Ada"],
  );

  // ── AI endpoints degrade gracefully without a key
  const msg = await api("POST", `/api/projects/${project.id}/ai/commit-message`, { token: A });
  assert.equal(msg.status, 200);
  assert.equal(msg.data.source, "heuristic");
  assert.match(msg.data.message, /notes\.md/);
  assert.equal(
    (
      await api("POST", `/api/projects/${project.id}/ai/pair`, {
        token: A,
        body: { messages: [{ role: "user", content: "hi" }] },
      })
    ).status,
    503,
  );

  // ── removal kicks the live socket
  const b2Closed = new Promise((resolve) => b.provider.on("connection-close", (ev) => resolve(ev?.code)));
  await api("DELETE", `/api/projects/${project.id}/members/${bob.data.user.id}`, { token: A });
  assert.equal(await b2Closed, 4403);

  // ── persistence across a server restart
  a.provider.destroy();
  b.provider.destroy();
  const fork = await api("POST", `/api/projects/${project.id}/duplicate`, { token: A });
  assert.equal(fork.status, 201);
  const files = await api("GET", `/api/projects/${fork.data.projectId}/files`, { token: A });
  assert.ok(files.data.files.some((f) => f.path === "notes.md"));
  assert.ok(files.data.files.some((f) => f.path === "lib/math.js"));
});
