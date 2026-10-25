import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { get, run } from "./db.ts";
import type { Role, User } from "../shared/types.ts";

const SESSION_DAYS = 7;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function createSession(userId: number): string {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)", token, userId, expires);
  return token;
}

export function destroySession(token: string) {
  run("DELETE FROM sessions WHERE token = ?", token);
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user: User;
      token: string;
    }
  }
}

export function readToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  const cookie = req.headers.cookie
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("mnt_session="));
  return cookie ? decodeURIComponent(cookie.split("=")[1]) : null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: "Not signed in" });
  const user = get<User>(
    `SELECT u.id, u.org_id, u.name, u.email, u.role, u.title, u.team_id, u.active
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`,
    token,
    new Date().toISOString(),
  );
  if (!user) return res.status(401).json({ error: "Session expired" });
  req.user = user;
  req.token = token;
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "You don't have permission for this action" });
    next();
  };
}

/** Reps see and edit only their own deals; managers and owners see the whole org. */
export function canSeeAll(user: User): boolean {
  return user.role === "owner" || user.role === "manager";
}
