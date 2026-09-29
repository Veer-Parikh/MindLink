import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, newId, USER_COLORS } from "../db.js";
import { HttpError, publicUser, requireAuth, signToken } from "../auth.js";

const router = Router();

const findByEmail = db.prepare("SELECT * FROM users WHERE email = ?");
const insertUser = db.prepare("INSERT INTO users (id, name, email, password_hash, color, created_at) VALUES (?, ?, ?, ?, ?, ?)");
const updateUser = db.prepare("UPDATE users SET name = ?, color = ? WHERE id = ?");
const getUser = db.prepare("SELECT * FROM users WHERE id = ?");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post("/register", async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  const email = String(req.body?.email ?? "")
    .trim()
    .toLowerCase();
  const password = String(req.body?.password ?? "");
  if (name.length < 2 || name.length > 40) throw new HttpError(400, "Name should be 2–40 characters.");
  if (!EMAIL_RE.test(email)) throw new HttpError(400, "That doesn't look like a valid email.");
  if (password.length < 6) throw new HttpError(400, "Password should be at least 6 characters.");
  if (findByEmail.get(email)) throw new HttpError(409, "An account with that email already exists.");

  const id = newId();
  const color = USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
  insertUser.run(id, name, email, await bcrypt.hash(password, 10), color, Date.now());
  const user = getUser.get(id);
  res.status(201).json({ token: signToken(id), user: publicUser(user) });
});

router.post("/login", async (req, res) => {
  const email = String(req.body?.email ?? "")
    .trim()
    .toLowerCase();
  const password = String(req.body?.password ?? "");
  const user = findByEmail.get(email);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new HttpError(401, "Wrong email or password.");
  }
  res.json({ token: signToken(user.id), user: publicUser(user) });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.patch("/me", requireAuth, (req, res) => {
  const name = req.body?.name !== undefined ? String(req.body.name).trim() : req.user.name;
  const color = req.body?.color !== undefined ? String(req.body.color) : req.user.color;
  if (name.length < 2 || name.length > 40) throw new HttpError(400, "Name should be 2–40 characters.");
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new HttpError(400, "Color must be a hex value like #22d3ee.");
  updateUser.run(name, color, req.user.id);
  res.json({ user: publicUser(getUser.get(req.user.id)) });
});

export default router;
