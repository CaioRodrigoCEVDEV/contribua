import { Router } from "express";
import bcrypt from "bcryptjs";
import { query } from "../db.js";
import { signToken, setAuthCookie, clearAuthCookie, requireAuth } from "../auth.js";

const router = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email };
}

router.post("/register", async (req, res, next) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (name.length < 2) return res.status(400).json({ error: "Informe seu nome." });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "E-mail inválido." });
    if (password.length < 6) return res.status(400).json({ error: "A senha precisa ter ao menos 6 caracteres." });

    const exists = await query("SELECT 1 FROM users WHERE email = $1", [email]);
    if (exists.rowCount > 0) return res.status(409).json({ error: "Este e-mail já está cadastrado." });

    const passwordHash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email",
      [name, email, passwordHash]
    );

    setAuthCookie(res, signToken(rows[0].id));
    res.status(201).json({ user: publicUser(rows[0]) });
  } catch (error) {
    next(error);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    const { rows } = await query("SELECT id, name, email, password_hash FROM users WHERE email = $1", [email]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "E-mail ou senha incorretos." });
    }

    setAuthCookie(res, signToken(user.id));
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

router.post("/logout", (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query("SELECT id, name, email FROM users WHERE id = $1", [req.userId]);
    if (!rows[0]) return res.status(401).json({ error: "Usuário não encontrado." });
    res.json({ user: publicUser(rows[0]) });
  } catch (error) {
    next(error);
  }
});

export default router;
