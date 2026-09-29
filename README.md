# MindLink

**Code together. Rewind anything.**

MindLink is a realtime collaborative code editor. Teams edit the same files at the same time with live named cursors, run code right in the browser and talk in chat and code threads. Every change lands on a **Rewind** timeline that you can scrub, replay like a video, compare with now and restore in one click.

## Features

| | |
|---|---|
| **Multiplayer editing** | Conflict-free sync (Yjs CRDT) with Monaco, named cursors and selections, presence dots in the file tree and tabs, and per-user undo: `Ctrl+Z` never undoes a teammate's work. |
| **Rewind** ⭐ | Snapshots are taken automatically a few seconds after people stop typing and credited to the people who made the changes. Scrub or play them back (1×/2×/4×), see each step's changed lines, compare any moment with now, and restore it for everyone. A restore is itself a snapshot, so it can be undone. |
| **Catch up** ⭐ | When you come back, a card lists what teammates changed while you were away (files, authors, checkpoints) and replays it in Rewind. With a Gemini key it also writes a short summary. |
| **Checkpoints** | Named moments on the timeline, like commits that include everyone's work. The message is suggested from the diff. |
| **Run anywhere** | JavaScript and TypeScript (multi-file `import`s), Python (Pyodide, with `import` between project files and packages like numpy) and live HTML/CSS/JS preview all run in the browser. Every run is shared with the room as a team terminal. Other languages can run through an optional [Piston](https://github.com/engineer-man/piston) server. |
| **Follow mode** | Click a teammate's avatar to follow their cursor across files. |
| **Code threads** | Comment on a line. Anchors follow the code as it moves. Threads have replies and can be resolved. |
| **Pair (AI)** | Optional assistant that sees your open file and selection, streams answers, and can insert code blocks at your cursor. Uses Gemini (free tier). |
| **Teams & roles** | Invite links and codes, owner/editor/viewer roles that update live. Viewers can still chat, comment and run code. |
| **And more** | Command palette (`Ctrl+K`), quick open (`Ctrl+P`), search across files, drag-and-drop file tree, project templates, fork, download as `.zip`. |

## Quick start

Requires **Node.js 22.13+** (it uses the built-in `node:sqlite`, so there's no database to install).

```bash
npm run setup     # install server + client dependencies
npm run dev       # API on :4000, app on http://localhost:5173
```

Open http://localhost:5173, create an account and start a project. To try collaboration, open a second browser (or a private window) with another account and join using the invite link from **Share**.

For a production-style single server:

```bash
npm start         # builds the client, then serves everything on http://localhost:4000
```

## Configuration

Copy `server/.env.example` to `server/.env`. Every setting is optional:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | API + realtime server port |
| `JWT_SECRET` | generated into `server/data/.jwt-secret` | Signs login tokens. **Set it in production.** |
| `DATABASE_FILE` | `./data/mindlink.db` | SQLite file (created automatically) |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Allowed browser origin(s) for CORS |
| `GEMINI_API_KEY` | – | Enables Pair, AI checkpoint messages and catch-up summaries. Get a free key at https://aistudio.google.com/apikey |
| `GEMINI_MODEL` | `gemini-flash-latest` | Gemini model to use |
| `PISTON_URL` | – | A self-hosted Piston instance for Java, C/C++, Go, Rust and more |

Without `GEMINI_API_KEY`, everything still works: checkpoint suggestions summarise the changed files instead, and the Pair panel shows how to turn AI on.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+K` / `Ctrl+P` | Command palette / quick open (type `>` for commands) |
| `Ctrl+Enter` | Run the active file (or open the preview for HTML) |
| `Ctrl+Shift+S` | Create a checkpoint |
| `Alt+R` | Open or close Rewind (`←` `→` step, `Space` play, `Esc` exit) |
| `Ctrl+Alt+M` | Comment on the current line |
| `Ctrl+B` / `Ctrl+J` | Toggle sidebar / console |
| `Esc` | Stop following a teammate |

## How it works

```
client/  React 19 + Vite · Monaco · Yjs (y-websocket provider) · Web Workers for JS/TS (Sucrase) and Python (Pyodide)
server/  Express 5 · ws · y-protocols · node:sqlite · Gemini via @google/genai
```

- Each project is one Y.Doc holding the file tree, one `Y.Text` per file, chat, the shared run log and code threads. The server speaks the standard y-websocket protocol, authenticates every socket with a JWT and drops document updates from viewers.
- Chat, runs and threads are written by the server through REST, so authorship can't be forged and viewers can take part.
- The server persists the Y.Doc and writes a full-project snapshot (with line stats and authors) after 4 seconds of quiet, or every 20 seconds during continuous typing. Those snapshots are the Rewind timeline, the catch-up baseline and the checkpoints.

## Tests

```bash
npm test
```

These boot the real server against a throwaway database and drive it over HTTP and WebSocket: accounts, invites, roles, live sync, viewer read-only enforcement, checkpoints, auto-snapshots, restore, catch-up, chat, threads, removal and forking. The AI routes are tested against a stub Gemini API, so no key or cost is needed.

## Upgrading from the hackathon version

The original code is still in `backend/` and `frontend/` (with a copy in `legacy-backup/`). The new app lives entirely in `server/` and `client/`, and you can delete the old folders once you no longer need them.
