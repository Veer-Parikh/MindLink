import dotenv from "dotenv";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, "..");

dotenv.config({ path: path.join(SERVER_ROOT, ".env"), quiet: true });

/** Without JWT_SECRET, generate one once and keep it in data/ so sessions survive restarts. */
function localSecret() {
  const file = path.join(SERVER_ROOT, "data", ".jwt-secret");
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    const secret = crypto.randomBytes(32).toString("hex");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, secret, { mode: 0o600 });
    console.warn("[mindlink] JWT_SECRET not set — generated one in server/data/.jwt-secret.");
    return secret;
  }
}

export const config = {
  port: Number(process.env.PORT) || 4000,
  jwtSecret: process.env.JWT_SECRET || localSecret(),
  databaseFile: path.resolve(SERVER_ROOT, process.env.DATABASE_FILE || "./data/mindlink.db"),
  clientOrigins: (process.env.CLIENT_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  // Gemini (free tier works): https://aistudio.google.com/apikey
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-flash-latest",
  geminiBaseUrl: process.env.GEMINI_BASE_URL || "", // only for proxies / tests
  get aiEnabled() {
    return Boolean(this.geminiApiKey);
  },
  pistonUrl: (process.env.PISTON_URL || "").replace(/\/$/, ""),
  clientDist: path.resolve(SERVER_ROOT, "../client/dist"),
  // How long a project must be idle before an automatic Rewind snapshot is taken.
  snapshotDebounceMs: 4000,
  // Upper bound on how long continuous typing can go without a snapshot.
  snapshotMaxWaitMs: 20000,
};
