const TOKEN_KEY = "mindlink.token";
const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export const tokenStore = {
  get() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* storage unavailable — session only lasts this tab */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const unauthorizedListeners = new Set();
export const onUnauthorized = (fn) => {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
};

function headers(extra) {
  const token = tokenStore.get();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

export async function api(path, { method = "GET", body, signal } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new ApiError(0, "Can't reach the MindLink server. Is it running?");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) unauthorizedListeners.forEach((fn) => fn());
    throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  }
  return data;
}

/** POSTs and consumes a server-sent-event stream, calling onEvent for every `data:` payload. */
export async function apiStream(path, body, onEvent, signal) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    method: "POST",
    headers: headers({ Accept: "text/event-stream" }),
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data: ")) {
          try {
            onEvent(JSON.parse(line.slice(6)));
          } catch {
            /* malformed chunk */
          }
        }
      }
    }
  }
}

export function collabUrl() {
  if (API_BASE) return `${API_BASE.replace(/^http/, "ws")}/collab`;
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/collab`;
}
