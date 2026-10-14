import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const COOKIE = "token";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function signToken(userId) {
  return jwt.sign({ uid: userId }, SECRET, { expiresIn: "7d" });
}

export function setAuthCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_MS
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE);
}

function readToken(req) {
  if (req.cookies && req.cookies[COOKIE]) return req.cookies[COOKIE];
  const header = req.get("authorization") || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  return null;
}

export function requireAuth(req, res, next) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: "Não autenticado." });
  try {
    const payload = jwt.verify(token, SECRET);
    req.userId = payload.uid;
    next();
  } catch {
    return res.status(401).json({ error: "Sessão inválida ou expirada." });
  }
}
