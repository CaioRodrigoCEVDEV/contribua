import { Router } from "express";
import { query as defaultQuery } from "../db.js";
import { requireAuth } from "../auth.js";
import { encryptSecret as defaultEncrypt, decryptSecret as defaultDecrypt } from "../crypto.js";
import { normalizeCrmEndpoint } from "../crm.js";

function mask(key) {
  if (!key) return "";
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

function crmState(user, secret) {
  const endpoint = user.crm_endpoint_url || "";
  const enabled = Boolean(user.crm_enabled);
  const hasSecret = Boolean(secret);
  const configured = Boolean(endpoint && hasSecret);
  return {
    enabled,
    endpoint_url: endpoint,
    has_secret: hasSecret,
    masked_secret: hasSecret ? "••••••••" : "",
    configured: Boolean(enabled && configured),
    status: !enabled ? "disabled" : configured ? "ready" : "incomplete"
  };
}

export function createSettingsRouter({
  query = defaultQuery,
  encrypt = defaultEncrypt,
  decrypt = defaultDecrypt,
  validateEndpoint = normalizeCrmEndpoint
} = {}) {
  const router = Router();
  router.use(requireAuth);

  router.get("/", async (req, res, next) => {
    try {
      const { rows } = await query(
        `SELECT openai_key, openai_model, openai_base_url,
                crm_enabled, crm_endpoint_url, crm_secret
           FROM users WHERE id = $1`,
        [req.userId]
      );
      const user = rows[0] || {};
      const key = decrypt(user.openai_key);
      const crmSecret = decrypt(user.crm_secret);
      res.json({
        settings: {
          has_key: Boolean(key),
          masked_key: mask(key),
          model: user.openai_model || "gpt-5.6-luna",
          base_url: user.openai_base_url || "",
          crm: crmState(user, crmSecret)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.put("/", async (req, res, next) => {
    try {
      const body = req.body || {};
      const { rows } = await query(
        "SELECT crm_enabled, crm_endpoint_url, crm_secret FROM users WHERE id = $1",
        [req.userId]
      );
      const current = rows[0];
      if (!current) return res.status(401).json({ error: "Usuário não encontrado." });

      const sets = [];
      const values = [];

      if (body.api_key !== undefined) {
        const apiKey = String(body.api_key).trim();
        values.push(apiKey ? encrypt(apiKey) : "");
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

      let crmEnabled = Boolean(current.crm_enabled);
      let crmEndpoint = current.crm_endpoint_url || "";
      let crmSecret = current.crm_secret || "";

      if (body.crm_enabled !== undefined) {
        crmEnabled = Boolean(body.crm_enabled);
        values.push(crmEnabled);
        sets.push(`crm_enabled = $${values.length}`);
      }
      if (body.crm_endpoint_url !== undefined) {
        const rawEndpoint = String(body.crm_endpoint_url).trim();
        crmEndpoint = rawEndpoint ? await validateEndpoint(rawEndpoint) : "";
        values.push(crmEndpoint);
        sets.push(`crm_endpoint_url = $${values.length}`);
      }
      if (body.crm_clear_secret === true) {
        crmSecret = "";
        values.push(crmSecret);
        sets.push(`crm_secret = $${values.length}`);
      } else if (body.crm_secret !== undefined) {
        const plainSecret = String(body.crm_secret).trim();
        if (plainSecret) {
          crmSecret = encrypt(plainSecret);
          values.push(crmSecret);
          sets.push(`crm_secret = $${values.length}`);
        }
      }

      if (!sets.length) return res.status(400).json({ error: "Nada para atualizar." });
      if (crmEnabled && (!crmEndpoint || !crmSecret)) {
        return res.status(400).json({
          error: "Informe a URL completa do webhook e o segredo antes de ativar a integração com o CRM.",
          code: "CRM_CONFIG_INCOMPLETE"
        });
      }

      values.push(req.userId);
      await query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${values.length}`, values);

      const state = crmState(
        { crm_enabled: crmEnabled, crm_endpoint_url: crmEndpoint },
        decrypt(crmSecret)
      );
      res.json({ ok: true, crm: state });
    } catch (error) {
      if (error?.name === "CrmValidationError") {
        return res.status(error.httpStatus || 400).json({ error: error.message, code: error.code });
      }
      next(error);
    }
  });

  return router;
}

export default createSettingsRouter();
