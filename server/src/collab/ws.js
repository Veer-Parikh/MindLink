/**
 * Realtime sync endpoint. Speaks the y-websocket wire protocol so the stock `y-websocket` client works,
 * with two MindLink additions:
 *   - every connection is authenticated (JWT in `?token=`) and scoped to one project membership;
 *   - viewers are read-only: their document updates are dropped, only awareness (cursors) passes through;
 *   - message type 100 carries server → client JSON events (new Rewind snapshots, restores, role changes).
 */
import { WebSocketServer } from "ws";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import { userFromToken, getMembership } from "../auth.js";
import { db } from "../db.js";
import { getDoc, scheduleUnload } from "./docs.js";

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_EVENT = 100;

const touchLastSeen = db.prepare("UPDATE members SET last_seen_at = ? WHERE project_id = ? AND user_id = ?");

function send(doc, conn, message) {
  if (conn.readyState !== conn.OPEN) {
    closeConn(doc, conn);
    return;
  }
  conn.send(message, (err) => err && closeConn(doc, conn));
}

function eventMessage(payload) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_EVENT);
  encoding.writeVarString(encoder, JSON.stringify(payload));
  return encoding.toUint8Array(encoder);
}

function closeConn(doc, conn) {
  const state = doc.conns.get(conn);
  if (!state) return;
  doc.conns.delete(conn);
  awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(state.awarenessIds), null);
  touchLastSeen.run(Date.now(), doc.projectId, state.user.id);
  if (doc.conns.size === 0) {
    if (doc.snapshotTimer) doc.snapshot("auto");
    scheduleUnload(doc);
  }
  try {
    conn.close();
  } catch {
    /* already closed */
  }
}

/** Wires broadcast plumbing onto a doc the first time a socket touches it. */
function ensureWired(doc) {
  if (doc.wired) return;
  doc.wired = true;

  doc.on("update", (update) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);
    for (const conn of doc.conns.keys()) send(doc, conn, message);
  });

  doc.awareness.on("update", ({ added, updated, removed }, origin) => {
    const changed = added.concat(updated, removed);
    const state = origin && doc.conns.get(origin);
    if (state) {
      for (const id of added) state.awarenessIds.add(id);
      for (const id of removed) state.awarenessIds.delete(id);
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(doc.awareness, changed));
    const message = encoding.toUint8Array(encoder);
    for (const conn of doc.conns.keys()) send(doc, conn, message);
  });

  doc.onBroadcast = (payload) => {
    const message = eventMessage(payload);
    for (const conn of doc.conns.keys()) send(doc, conn, message);
  };
}

function handleMessage(doc, conn, data) {
  const state = doc.conns.get(conn);
  if (!state) return;
  try {
    const decoder = decoding.createDecoder(new Uint8Array(data));
    const encoder = encoding.createEncoder();
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC: {
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        if (state.role === "viewer") {
          // Answer sync requests, but never apply a viewer's changes.
          const syncType = decoding.readVarUint(decoder);
          if (syncType === syncProtocol.messageYjsSyncStep1) {
            syncProtocol.readSyncStep1(decoder, encoder, doc);
          }
        } else {
          syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
        }
        if (encoding.length(encoder) > 1) send(doc, conn, encoding.toUint8Array(encoder));
        break;
      }
      case MESSAGE_AWARENESS:
        awarenessProtocol.applyAwarenessUpdate(doc.awareness, decoding.readVarUint8Array(decoder), conn);
        break;
      default:
        break;
    }
  } catch (err) {
    console.error("[collab] bad message", err);
  }
}

/** Pushes a JSON event to every socket of one user in one project (e.g. after a role change). */
export function notifyUser(doc, userId, payload) {
  const message = eventMessage(payload);
  for (const [conn, state] of doc.conns) if (state.user.id === userId) send(doc, conn, message);
}

/** Updates the live role of a member's open sockets and tells them about it. */
export function applyRoleChange(doc, userId, role) {
  for (const [conn, state] of doc.conns) {
    if (state.user.id !== userId) continue;
    if (role === null) {
      send(doc, conn, eventMessage({ type: "removed" }));
      conn.close(4403, "Removed from project");
      continue;
    }
    state.role = role;
    send(doc, conn, eventMessage({ type: "role", role }));
  }
}

export function attachCollabServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://localhost");
    const match = url.pathname.match(/^\/collab\/([\w-]+)$/);
    if (!match) return; // not ours — let other handlers (e.g. Vite HMR in dev) have it
    const reject = (code, reason) => {
      socket.write(`HTTP/1.1 ${code} ${reason}\r\n\r\n`);
      socket.destroy();
    };
    const user = userFromToken(url.searchParams.get("token"));
    if (!user) return reject(401, "Unauthorized");
    const membership = getMembership(match[1], user.id);
    if (!membership) return reject(403, "Forbidden");

    wss.handleUpgrade(req, socket, head, (conn) => {
      const doc = getDoc(match[1]);
      if (!doc) return conn.close(4404, "Project not found");
      ensureWired(doc);
      clearTimeout(doc.unloadTimer);
      // last_seen_at is only bumped on disconnect, so "Catch up" stays stable for the whole session.
      doc.conns.set(conn, { user, role: membership.role, awarenessIds: new Set() });
      conn.binaryType = "arraybuffer";
      conn.on("message", (data) => handleMessage(doc, conn, data));

      let alive = true;
      conn.on("pong", () => (alive = true));
      const ping = setInterval(() => {
        if (!alive) {
          closeConn(doc, conn);
          clearInterval(ping);
          return;
        }
        alive = false;
        try {
          conn.ping();
        } catch {
          closeConn(doc, conn);
          clearInterval(ping);
        }
      }, 30_000);
      conn.on("close", () => {
        closeConn(doc, conn);
        clearInterval(ping);
      });

      // Initial handshake: sync step 1 + current awareness + who you are.
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, doc);
      send(doc, conn, encoding.toUint8Array(encoder));
      const states = doc.awareness.getStates();
      if (states.size > 0) {
        const aw = encoding.createEncoder();
        encoding.writeVarUint(aw, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(aw, awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(states.keys())));
        send(doc, conn, encoding.toUint8Array(aw));
      }
      send(doc, conn, eventMessage({ type: "hello", role: membership.role }));
    });
  });

  return wss;
}
