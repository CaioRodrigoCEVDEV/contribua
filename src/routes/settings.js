import { Router } from "express";
import { query } from "../db.js";
import { requireAuth } from "../auth.js";
import { encryptSecret, decryptSecret } from "../crypto.js";

const router = Router();
router.use(requireAuth);

function mask(key) {
  if (!key) return "";
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

router.get("/", async (req, res, next) => {
  try {
    const { rows } = await query(
      "SELECT openai_key, openai_model, openai_base_url FROM users WHERE id = $1",
      [req.userId]
    );
    const user = rows[0] || {};
    const key = decryptSecret(user.openai_key);
    res.json({
      settings: {
        has_key: Boolean(key),
        masked_key: mask(key),
        model: user.openai_model || "gpt-4o-mini",
        base_url: user.openai_base_url || ""
      }
    });
  } catch (error) {
    next(error);
  }
});

router.put("/", async (req, res, next) => {
  try {
    const body = req.body || {};
    const sets = [];
    const values = [];

    if (body.api_key !== undefined) {
      const apiKey = String(body.api_key).trim();
      values.push(apiKey ? encryptSecret(apiKey) : "");
      sets.push(`openai_key = $${values.length}`);
    }
    if (body.model !== undefined) {
      values.push(String(body.model).trim().slice(0, 80));
      sets.push(`openai_model = $${values.length}`);
    }
    if (body.base_url !== undefined) {
      values.push(String(body.base_url).trim().slice(0, 200));
      sets.push(`openai_base_url = $${values.length}`);
    }

    if (!sets.length) return res.status(400).json({ error: "Nada para atualizar." });

    values.push(req.userId);
    await query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
