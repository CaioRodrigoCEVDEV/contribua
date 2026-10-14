import { Router } from "express";
import { query } from "../db.js";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadBySlug(slug) {
  const { rows } = await query("SELECT * FROM payment_tables WHERE slug = $1", [slug]);
  return rows[0] || null;
}

async function loadImages(table) {
  const { rows } = await query(
    "SELECT id FROM table_images WHERE table_id = $1 ORDER BY position, created_at",
    [table.id]
  );
  return rows.map((row) => ({ id: row.id, url: `/api/public/${table.slug}/images/${row.id}` }));
}

function publicShape(table, participants, images = []) {
  const total = participants.length;
  const paid = participants.filter((p) => p.paid).length;
  return {
    slug: table.slug,
    title: table.title,
    subtitle: table.subtitle,
    installment_label: table.installment_label,
    installment_due: table.installment_due,
    installment_cents: table.installment_cents,
    total_goal_cents: table.total_goal_cents,
    pix_name: table.pix_name,
    pix_key: table.pix_key,
    header_image: table.header_image,
    location_address: table.location_address,
    location_url: table.location_url,
    images,
    allow_public_edit: table.allow_public_edit,
    summary: {
      total,
      paid,
      pending: total - paid,
      received_cents: paid * table.installment_cents,
      pending_cents: (total - paid) * table.installment_cents
    },
    participants: participants.map((p) => ({ id: p.id, name: p.name, paid: p.paid, note: p.note }))
  };
}

router.get("/:slug", async (req, res, next) => {
  try {
    const table = await loadBySlug(req.params.slug);
    if (!table) return res.status(404).json({ error: "Tabela não encontrada." });
    const { rows } = await query(
      "SELECT id, name, paid, note FROM participants WHERE table_id = $1 ORDER BY position, name",
      [table.id]
    );
    res.json({ table: publicShape(table, rows, await loadImages(table)) });
  } catch (error) {
    next(error);
  }
});

router.get("/:slug/images/:imageId", async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.imageId)) return res.status(404).end();
    const { rows } = await query(
      `SELECT ti.image FROM table_images ti
         JOIN payment_tables t ON t.id = ti.table_id
        WHERE ti.id = $1 AND t.slug = $2`,
      [req.params.imageId, req.params.slug]
    );
    const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(rows[0]?.image || "");
    if (!match) return res.status(404).end();
    res.set("Cache-Control", "public, max-age=86400");
    res.type(match[1]).send(Buffer.from(match[2], "base64"));
  } catch (error) {
    next(error);
  }
});

router.post("/:slug/toggle", async (req, res, next) => {
  try {
    const table = await loadBySlug(req.params.slug);
    if (!table) return res.status(404).json({ error: "Tabela não encontrada." });
    if (!table.allow_public_edit) {
      return res.status(403).json({ error: "Esta tabela não permite edição pelo link." });
    }

    const participantId = String(req.body?.participantId || "");
    const { rows } = await query(
      `UPDATE participants
          SET paid = NOT paid, updated_at = now()
        WHERE id = $1 AND table_id = $2
        RETURNING id, name, paid, note`,
      [participantId, table.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Participante não encontrado." });

    const { rows: all } = await query(
      "SELECT id, name, paid, note FROM participants WHERE table_id = $1 ORDER BY position, name",
      [table.id]
    );
    res.json({ table: publicShape(table, all, await loadImages(table)) });
  } catch (error) {
    next(error);
  }
});

export default router;
