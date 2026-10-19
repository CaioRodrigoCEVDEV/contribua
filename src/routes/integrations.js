import { Router } from "express";
import { query as defaultQuery } from "../db.js";
import { requireAuth } from "../auth.js";
import { decryptSecret as defaultDecrypt } from "../crypto.js";
import {
  CRM_MAX_MESSAGE_LENGTH,
  CrmSendError,
  CrmValidationError,
  sendCrmMessage
} from "../crm.js";

export function createIntegrationsRouter({
  query = defaultQuery,
  decrypt = defaultDecrypt,
  send = sendCrmMessage
} = {}) {
  const router = Router();
  router.use(requireAuth);

  router.post("/crm/send", async (req, res, next) => {
    try {
      const { rows } = await query(
        "SELECT crm_enabled, crm_endpoint_url, crm_secret FROM users WHERE id = $1",
        [req.userId]
      );
      const user = rows[0];
      if (!user) return res.status(401).json({ error: "Usuário não encontrado." });

      if (!user.crm_enabled) {
        return res.status(409).json({
          error: "A integração com o CRM está desativada. Ative-a em Configurações.",
          code: "CRM_DISABLED"
        });
      }

      const endpoint = String(user.crm_endpoint_url || "").trim();
      const secret = decrypt(user.crm_secret);
      if (!endpoint || !secret) {
        return res.status(409).json({
          error: "A integração com o CRM não está configurada. Informe a URL do webhook e o segredo em Configurações.",
          code: "CRM_NOT_CONFIGURED"
        });
      }

      const message = req.body?.message;
      if (typeof message !== "string" || !message.trim()) {
        return res.status(400).json({
          error: "Informe a mensagem que será enviada ao CRM.",
          code: "CRM_MESSAGE_REQUIRED"
        });
      }
      if (message.length > CRM_MAX_MESSAGE_LENGTH) {
        return res.status(400).json({
          error: `A mensagem excede o limite de ${CRM_MAX_MESSAGE_LENGTH} caracteres do CRM.`,
          code: "CRM_MESSAGE_TOO_LONG"
        });
      }

      const imageUrl = req.body?.image_url;
      if (imageUrl !== undefined && imageUrl !== null && typeof imageUrl !== "string") {
        return res.status(400).json({
          error: "A URL da imagem é inválida.",
          code: "CRM_IMAGE_URL_INVALID"
        });
      }

      const result = await send({
        endpoint,
        secret,
        message,
        imageUrl: imageUrl || undefined,
        idempotencyKey: req.body?.idempotency_key
      });

      const statusCode = result.status === "processing" ? 202 : 200;
      return res.status(statusCode).json(result);
    } catch (error) {
      if (error instanceof CrmSendError || error instanceof CrmValidationError) {
        return res.status(error.httpStatus || 502).json({
          error: error.message,
          code: error.code,
          keep_idempotency_key: Boolean(error.keepIdempotencyKey),
          unknown_result: Boolean(error.unknownResult),
          idempotency_key: error.idempotencyKey || null
        });
      }
      next(error);
    }
  });

  return router;
}

export default createIntegrationsRouter();
