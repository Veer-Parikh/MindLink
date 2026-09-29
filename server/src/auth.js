import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { db } from "./db.js";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function signToken(userId) {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: "30d" });
}

const getUserStmt = db.prepare("SELECT id, name, email, color, created_at FROM users WHERE id = ?");

export function publicUser(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, email: row.email, color: row.color, createdAt: row.created_at };
}

/** Resolves a raw JWT to a user row, or null when invalid. */
export function userFromToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    return getUserStmt.get(payload.sub) ?? null;
  } catch {
    return null;
  }
}

export function requireAuth(req, _res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const user = userFromToken(token);
  if (!user) return next(new HttpError(401, "Please sign in to continue."));
  req.user = user;
  next();
}

const membershipStmt = db.prepare(`
  SELECT p.*, m.role, m.last_seen_at
  FROM projects p JOIN members m ON m.project_id = p.id
  WHERE p.id = ? AND m.user_id = ?
`);

export function getMembership(projectId, userId) {
  return membershipStmt.get(projectId, userId) ?? null;
}

const ROLE_RANK = { viewer: 0, editor: 1, owner: 2 };

/** Express middleware: loads req.project and asserts the caller has at least `minRole`. */
export function requireRole(minRole = "viewer") {
  return (req, _res, next) => {
    const project = getMembership(req.params.projectId, req.user.id);
    if (!project) return next(new HttpError(404, "Project not found or you don't have access."));
    if (ROLE_RANK[project.role] < ROLE_RANK[minRole]) {
      return next(new HttpError(403, `This action needs ${minRole} access.`));
    }
    req.project = project;
    next();
  };
}
