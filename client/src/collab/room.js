import { useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import * as decoding from "lib0/decoding";
import { collabUrl, tokenStore } from "../lib/api.js";

const MESSAGE_EVENT = 100;

/**
 * One live connection to a project: a Y.Doc kept in sync over y-websocket, awareness for presence,
 * and a tiny event bus for JSON events the server pushes (snapshots, restores, role changes…).
 */
export function createRoom(projectId, user) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(collabUrl(), projectId, doc, {
    params: { token: tokenStore.get() ?? "" },
    disableBc: true,
    maxBackoffTime: 4000,
  });
  const listeners = new Set();
  provider.messageHandlers[MESSAGE_EVENT] = (_encoder, decoder) => {
    try {
      const event = JSON.parse(decoding.readVarString(decoder));
      listeners.forEach((fn) => fn(event));
    } catch (err) {
      console.error("[mindlink] bad server event", err);
    }
  };
  provider.on("connection-close", (event) => {
    if (event?.code === 4403) listeners.forEach((fn) => fn({ type: "removed" }));
    if (event?.code === 4404) listeners.forEach((fn) => fn({ type: "deleted" }));
  });
  provider.awareness.setLocalState({
    user: { id: user.id, name: user.name, color: user.color },
    fileId: null,
    cursor: null,
  });
  return {
    doc,
    provider,
    awareness: provider.awareness,
    onEvent(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setPresence(patch) {
      const current = provider.awareness.getLocalState() ?? {};
      provider.awareness.setLocalState({ ...current, ...patch });
    },
    destroy() {
      listeners.clear();
      provider.destroy();
      doc.destroy();
    },
  };
}

export function useRoom(projectId, user) {
  const [room, setRoom] = useState(null);
  useEffect(() => {
    if (!projectId || !user) return undefined;
    const r = createRoom(projectId, user);
    setRoom(r);
    return () => {
      setRoom(null);
      // Let child components (editor bindings) detach first.
      setTimeout(() => r.destroy(), 0);
    };
    // user identity changes (name/color) are pushed through setPresence instead of reconnecting
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, user?.id]);
  return room;
}

/** "connecting" | "connected" | "disconnected", plus whether the first sync finished. */
export function useConnection(room) {
  const [state, setState] = useState({ status: "connecting", synced: false });
  useEffect(() => {
    if (!room) return undefined;
    const { provider } = room;
    const update = () =>
      setState({
        status: provider.wsconnected ? "connected" : provider.wsconnecting ? "connecting" : "disconnected",
        synced: provider.synced,
      });
    provider.on("status", update);
    provider.on("sync", update);
    update();
    return () => {
      provider.off("status", update);
      provider.off("sync", update);
    };
  }, [room]);
  return state;
}

/** Re-renders whenever a Y type (deeply) changes; returns a version number usable as a memo key. */
export function useYVersion(type) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!type) return undefined;
    const bump = () => setVersion((v) => v + 1);
    type.observeDeep(bump);
    bump();
    return () => type.unobserveDeep(bump);
  }, [type]);
  return version;
}

/** Array snapshot of a Y.Array, kept current. */
export function useYArray(type) {
  const version = useYVersion(type);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (type ? type.toArray() : []), [type, version]);
}

/** Plain-object snapshot of a Y.Map's values, kept current. */
export function useYMapValues(type) {
  const version = useYVersion(type);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (type ? Array.from(type.values()) : []), [type, version]);
}

/** Everyone else connected to the room: [{ clientId, user, fileId, cursor, ... }]. */
export function usePeers(room) {
  const [peers, setPeers] = useState([]);
  useEffect(() => {
    if (!room) return undefined;
    const { awareness, doc } = room;
    let frame = 0;
    const compute = () => {
      frame = 0;
      const list = [];
      awareness.getStates().forEach((state, clientId) => {
        if (clientId !== doc.clientID && state?.user) list.push({ clientId, ...state });
      });
      list.sort((a, b) => a.user.name.localeCompare(b.user.name));
      setPeers(list);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(compute);
    };
    awareness.on("change", schedule);
    compute();
    return () => {
      awareness.off("change", schedule);
      cancelAnimationFrame(frame);
    };
  }, [room]);
  return peers;
}

/** Collapses multiple tabs of the same person into one entry. */
export function uniquePeople(peers) {
  const seen = new Map();
  for (const p of peers) if (!seen.has(p.user.id)) seen.set(p.user.id, p);
  return Array.from(seen.values());
}
