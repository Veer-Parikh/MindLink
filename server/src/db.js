import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(config.databaseFile), { recursive: true });

export const db = new DatabaseSync(config.databaseFile);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    color         TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    template    TEXT NOT NULL DEFAULT 'blank',
    owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invite_code TEXT NOT NULL UNIQUE,
    ydoc        BLOB,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS members (
    project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role         TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
    joined_at    INTEGER NOT NULL,
    last_seen_at INTEGER,
    PRIMARY KEY (project_id, user_id)
  );

  -- Rewind timeline: full-project snapshots taken automatically while people work,
  -- plus named checkpoints (MindLink's "commits").
  CREATE TABLE IF NOT EXISTS snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('auto', 'checkpoint', 'restore', 'initial')),
    message     TEXT,
    author_ids  TEXT NOT NULL DEFAULT '[]',
    files       TEXT NOT NULL,
    hash        TEXT NOT NULL,
    added       INTEGER NOT NULL DEFAULT 0,
    removed     INTEGER NOT NULL DEFAULT 0,
    created_by  TEXT,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_snapshots_project ON snapshots(project_id, created_at);
`);

export const newId = (bytes = 9) => crypto.randomBytes(bytes).toString("base64url");

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newInviteCode() {
  const bytes = crypto.randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) code += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export const USER_COLORS = [
  "#22d3ee",
  "#a78bfa",
  "#f472b6",
  "#fb923c",
  "#4ade80",
  "#facc15",
  "#60a5fa",
  "#f87171",
  "#2dd4bf",
  "#c084fc",
];

/** Runs fn inside a transaction, rolling back on throw. */
export function transaction(fn) {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
