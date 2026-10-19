import { Router } from "express";
import { pool, query } from "../db.js";
import { requireAuth } from "../auth.js";
import { uniqueSlug } from "../slug.js";
import { decryptSecret } from "../crypto.js";
import { generateWhatsappMessage } from "../openai.js";

const router = Router();
router.use(requireAuth);

function toCents(value, fallback = 0) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function sanitizeImage(value, fallback = "") {
  if (value === undefined) return fallback;
  const str = String(value).trim();
  if (!str) return "";
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(str)) return fallback;
  return str.length > 2_000_000 ? fallback : str;
}

function sanitizeUrl(value, fallback = "") {
  if (value === undefined) return fallback;
  const str = String(value).trim();
  if (!str) return "";
  if (!/^https?:\/\//i.test(str)) return fallback;
  return str.slice(0, 500);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitizeFields(body, existing = {}) {
  const pick = (key, fallback = "") => (body[key] === undefined ? fallback : String(body[key]).trim());
  return {
    title: pick("title", existing.title || "").slice(0, 80),
    subtitle: pick("subtitle", existing.subtitle ?? "").slice(0, 80),
    installment_label: pick("installment_label", existing.installment_label ?? "1ª PARCELA").slice(0, 60),
    installment_due: pick("installment_due", existing.installment_due ?? "").slice(0, 40),
    installment_cents: toCents(body.installment_cents ?? existing.installment_cents ?? 5000, 5000),
    total_goal_cents: toCents(body.total_goal_cents ?? existing.total_goal_cents ?? 0, 0),
    pix_name: pick("pix_name", existing.pix_name ?? "").slice(0, 80),
    pix_key: pick("pix_key", existing.pix_key ?? "").slice(0, 120),
    header_image: sanitizeImage(body.header_image, existing.header_image ?? ""),
    location_address: pick("location_address", existing.location_address ?? "").slice(0, 160),
    location_url: sanitizeUrl(body.location_url, existing.location_url ?? ""),
    allow_public_edit: body.allow_public_edit === undefined
      ? existing.allow_public_edit ?? true
      : Boolean(body.allow_public_edit)
  };
}

async function loadOwned(tableId, userId) {
  const { rows } = await query(
    "SELECT * FROM payment_tables WHERE id = $1 AND user_id = $2",
    [tableId, userId]
  );
  return rows[0] || null;
}

async function loadParticipants(tableId) {
  const { rows } = await query(
    "SELECT id, name, paid, note, position FROM participants WHERE table_id = $1 ORDER BY position, name",
    [tableId]
  );
  return rows;
}

async function loadImages(table) {
  const { rows } = await query(
    "SELECT id FROM table_images WHERE table_id = $1 ORDER BY position, created_at",
    [table.id]
  );
  return rows.map((row) => ({ id: row.id, url: `/api/public/${table.slug}/images/${row.id}` }));
}

function withStats(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    installment_label: row.installment_label,
    installment_due: row.installment_due,
    installment_cents: row.installment_cents,
    total_goal_cents: row.total_goal_cents,
    pix_name: row.pix_name,
    pix_key: row.pix_key,
    header_image: row.header_image,
    location_address: row.location_address,
    location_url: row.location_url,
    allow_public_edit: row.allow_public_edit,
    visits: Number(row.visits ?? 0),
    total_participants: Number(row.total_participants ?? 0),
    paid_participants: Number(row.paid_participants ?? 0),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

router.get("/", async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT t.*,
              COUNT(p.id) AS total_participants,
              COUNT(p.id) FILTER (WHERE p.paid) AS paid_participants
         FROM payment_tables t
         LEFT JOIN participants p ON p.table_id = t.id
        WHERE t.user_id = $1
        GROUP BY t.id
        ORDER BY t.created_at DESC`,
      [req.userId]
    );
    res.json({ tables: rows.map(withStats) });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const fields = sanitizeFields(req.body || {});
    if (!fields.title) return res.status(400).json({ error: "Informe o título da tabela." });

    const slug = await uniqueSlug(fields.title);
    const names = Array.isArray(req.body?.participants) ? req.body.participants : [];
    const cleanNames = names.map((n) => String(n).trim()).filter(Boolean).slice(0, 500);

    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO payment_tables
         (user_id, slug, title, subtitle, installment_label, installment_due,
          installment_cents, total_goal_cents, pix_name, pix_key, header_image,
          location_address, location_url, allow_public_edit)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        req.userId, slug, fields.title, fields.subtitle, fields.installment_label,
        fields.installment_due, fields.installment_cents, fields.total_goal_cents,
        fields.pix_name, fields.pix_key, fields.header_image,
        fields.location_address, fields.location_url, fields.allow_public_edit
      ]
    );
    const table = rows[0];

    for (let i = 0; i < cleanNames.length; i += 1) {
      await client.query(
        "INSERT INTO participants (table_id, name, position) VALUES ($1, $2, $3)",
        [table.id, cleanNames[i], i]
      );
    }

    await client.query("COMMIT");
    res.status(201).json({ table: { ...withStats(table), participants: await loadParticipants(table.id) } });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

router.post("/:id/duplicate", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const source = await loadOwned(req.params.id, req.userId);
    if (!source) return res.status(404).json({ error: "Tabela não encontrada." });

    const requested = req.body?.title === undefined ? "" : String(req.body.title).trim();
    const title = (requested || `${source.title} (cópia)`).slice(0, 80);
    const slug = await uniqueSlug(title);

    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO payment_tables
         (user_id, slug, title, subtitle, installment_label, installment_due,
          installment_cents, total_goal_cents, pix_name, pix_key, header_image,
          location_address, location_url, allow_public_edit)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        req.userId, slug, title, source.subtitle, source.installment_label, source.installment_due,
        source.installment_cents, source.total_goal_cents, source.pix_name, source.pix_key,
        source.header_image, source.location_address, source.location_url, source.allow_public_edit
      ]
    );
    const table = rows[0];

    await client.query(
      `INSERT INTO participants (table_id, name, paid, note, position)
       SELECT $1, name, false, '', position FROM participants WHERE table_id = $2 ORDER BY position, name`,
      [table.id, source.id]
    );

    await client.query(
      `INSERT INTO table_images (table_id, image, position)
       SELECT $1, image, position FROM table_images WHERE table_id = $2 ORDER BY position, created_at`,
      [table.id, source.id]
    );

    await client.query("COMMIT");
    res.status(201).json({ table: { ...withStats(table), participants: await loadParticipants(table.id) } });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const table = await loadOwned(req.params.id, req.userId);
    if (!table) return res.status(404).json({ error: "Tabela não encontrada." });
    res.json({
      table: {
        ...withStats(table),
        participants: await loadParticipants(table.id),
        images: await loadImages(table)
      }
    });
  } catch (error) {
    next(error);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const table = await loadOwned(req.params.id, req.userId);
    if (!table) return res.status(404).json({ error: "Tabela não encontrada." });

    const fields = sanitizeFields(req.body || {}, table);
    if (!fields.title) return res.status(400).json({ error: "Informe o título da tabela." });

    const { rows } = await query(
      `UPDATE payment_tables
          SET title=$1, subtitle=$2, installment_label=$3, installment_due=$4,
              installment_cents=$5, total_goal_cents=$6, pix_name=$7, pix_key=$8,
              header_image=$9, location_address=$10, location_url=$11,
              allow_public_edit=$12, updated_at=now()
        WHERE id=$13 AND user_id=$14
        RETURNING *`,
      [
        fields.title, fields.subtitle, fields.installment_label, fields.installment_due,
        fields.installment_cents, fields.total_goal_cents, fields.pix_name, fields.pix_key,
        fields.header_image, fields.location_address, fields.location_url,
        fields.allow_public_edit, req.params.id, req.userId
      ]
    );
    res.json({ table: { ...withStats(rows[0]), participants: await loadParticipants(req.params.id) } });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/message", async (req, res, next) => {
  try {
    const table = await loadOwned(req.params.id, req.userId);
    if (!table) return res.status(404).json({ error: "Tabela não encontrada." });

    const { rows: userRows } = await query(
      "SELECT openai_key, openai_model, openai_base_url FROM users WHERE id = $1",
      [req.userId]
    );
    const user = userRows[0] || {};
    const apiKey = decryptSecret(user.openai_key);
    if (!apiKey) {
      return res.status(400).json({ error: "Configure sua API key em Configurações para gerar mensagens." });
    }

    const participants = await loadParticipants(table.id);
    const total = participants.length;
    const paid = participants.filter((p) => p.paid).length;

    const requestedOrigin = String(req.body?.origin || "").trim().replace(/\/+$/, "");
    const base = /^https?:\/\//i.test(requestedOrigin)
      ? requestedOrigin
      : `${req.protocol}://${req.get("host")}`;
    const link = `${base}/t/${table.slug}`;
    const imageUrl = `${base}/t/${table.slug}/og-image`;

    let message;
    try {
      message = await generateWhatsappMessage({
        apiKey,
        baseUrl: user.openai_base_url,
        model: user.openai_model,
        data: {
          title: table.title,
          subtitle: table.subtitle,
          installmentLabel: table.installment_label,
          installmentDue: table.installment_due,
          installmentCents: table.installment_cents,
          totalGoalCents: table.total_goal_cents,
          pixName: table.pix_name,
          pixKey: table.pix_key,
          totalParticipants: total,
          paidParticipants: paid,
          pendingParticipants: total - paid,
          receivedCents: paid * table.installment_cents,
          pendingCents: (total - paid) * table.installment_cents,
          link
        }
      });
    } catch (error) {
      return res.status(502).json({ error: error.message || "Falha ao gerar a mensagem." });
    }

    res.json({ message, image_url: imageUrl });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const { rowCount } = await query(
      "DELETE FROM payment_tables WHERE id = $1 AND user_id = $2",
      [req.params.id, req.userId]
    );
    if (rowCount === 0) return res.status(404).json({ error: "Tabela não encontrada." });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/participants", async (req, res, next) => {
  try {
    const table = await loadOwned(req.params.id, req.userId);
    if (!table) return res.status(404).json({ error: "Tabela não encontrada." });

    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "Informe o nome do participante." });

    const { rows: posRows } = await query(
      "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM participants WHERE table_id = $1",
      [table.id]
    );
    const { rows } = await query(
      "INSERT INTO participants (table_id, name, position) VALUES ($1, $2, $3) RETURNING id, name, paid, note, position",
      [table.id, name.slice(0, 80), posRows[0].next]
    );
    res.status(201).json({ participant: rows[0] });
  } catch (error) {
    next(error);
  }
});

async function ownedParticipant(participantId, userId) {
  const { rows } = await query(
    `SELECT p.* FROM participants p
       JOIN payment_tables t ON t.id = p.table_id
      WHERE p.id = $1 AND t.user_id = $2`,
    [participantId, userId]
  );
  return rows[0] || null;
}

router.put("/:id/participants/:pid", async (req, res, next) => {
  try {
    const existing = await ownedParticipant(req.params.pid, req.userId);
    if (!existing || existing.table_id !== req.params.id) {
      return res.status(404).json({ error: "Participante não encontrado." });
    }
    const name = req.body?.name === undefined ? existing.name : String(req.body.name).trim().slice(0, 80);
    const paid = req.body?.paid === undefined ? existing.paid : Boolean(req.body.paid);
    const note = req.body?.note === undefined ? existing.note : String(req.body.note).trim().slice(0, 120);
    if (!name) return res.status(400).json({ error: "Informe o nome do participante." });

    const { rows } = await query(
      `UPDATE participants SET name=$1, paid=$2, note=$3, updated_at=now()
        WHERE id=$4 RETURNING id, name, paid, note, position`,
      [name, paid, note, existing.id]
    );
    res.json({ participant: rows[0] });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id/participants/:pid", async (req, res, next) => {
  try {
    const existing = await ownedParticipant(req.params.pid, req.userId);
    if (!existing || existing.table_id !== req.params.id) {
      return res.status(404).json({ error: "Participante não encontrado." });
    }
    await query("DELETE FROM participants WHERE id = $1", [existing.id]);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/images", async (req, res, next) => {
  try {
    const table = await loadOwned(req.params.id, req.userId);
    if (!table) return res.status(404).json({ error: "Tabela não encontrada." });

    const image = sanitizeImage(req.body?.image, "");
    if (!image) return res.status(400).json({ error: "Selecione uma imagem válida." });

    const { rows: countRows } = await query(
      "SELECT COUNT(*)::int AS n FROM table_images WHERE table_id = $1",
      [table.id]
    );
    if (countRows[0].n >= 12) return res.status(400).json({ error: "Limite de 12 fotos atingido." });

    const { rows: posRows } = await query(
      "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM table_images WHERE table_id = $1",
      [table.id]
    );
    const { rows } = await query(
      "INSERT INTO table_images (table_id, image, position) VALUES ($1, $2, $3) RETURNING id",
      [table.id, image, posRows[0].next]
    );
    res.status(201).json({ image: { id: rows[0].id, url: `/api/public/${table.slug}/images/${rows[0].id}` } });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id/images/:imageId", async (req, res, next) => {
  try {
    const table = await loadOwned(req.params.id, req.userId);
    if (!table) return res.status(404).json({ error: "Tabela não encontrada." });
    if (!UUID_RE.test(req.params.imageId)) return res.status(404).json({ error: "Imagem não encontrada." });
    await query("DELETE FROM table_images WHERE id = $1 AND table_id = $2", [req.params.imageId, table.id]);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
