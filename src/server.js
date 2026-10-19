import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express from "express";
import cookieParser from "cookie-parser";

import authRoutes from "./routes/auth.js";
import tableRoutes from "./routes/tables.js";
import publicRoutes from "./routes/public.js";
import settingsRoutes from "./routes/settings.js";
import integrationRoutes from "./routes/integrations.js";
import { pool } from "./db.js";

process.on("unhandledRejection", (error) => console.error("Unhandled rejection:", error));
process.on("uncaughtException", (error) => console.error("Uncaught exception:", error));

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "public");

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "3mb" }));
app.use(cookieParser());

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/tables", tableRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/integrations", integrationRoutes);

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

app.get("/dashboard", (req, res) => res.sendFile(join(publicDir, "dashboard.html")));

app.get("/t/:slug/og-image", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT header_image FROM payment_tables WHERE slug = $1", [req.params.slug]);
    const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(rows[0]?.header_image || "");
    if (match) {
      res.set("Cache-Control", "public, max-age=3600");
      return res.type(match[1]).send(Buffer.from(match[2], "base64"));
    }
    res.set("Cache-Control", "public, max-age=86400");
    res.sendFile(join(publicDir, "og-default.png"));
  } catch (error) {
    next(error);
  }
});

app.get("/t/:slug", async (req, res, next) => {
  try {
    const html = await readFile(join(publicDir, "poster.html"), "utf8");
    const { rows } = await pool.query(
      "SELECT title, subtitle FROM payment_tables WHERE slug = $1",
      [req.params.slug]
    );
    const table = rows[0];
    if (!table) return res.type("html").send(html);

    const base = `${req.protocol}://${req.get("host")}`;
    const slug = encodeURIComponent(req.params.slug);
    const url = `${base}/t/${slug}`;
    const image = `${base}/t/${slug}/og-image`;
    const title = [table.title, table.subtitle].filter(Boolean).join(" — ") || "Contribua";
    const description = "Acompanhe as contribuições e veja quem já pagou.";
    const tags = [
      `<meta property="og:type" content="website">`,
      `<meta property="og:title" content="${escapeHtml(title)}">`,
      `<meta property="og:description" content="${escapeHtml(description)}">`,
      `<meta property="og:url" content="${url}">`,
      `<meta property="og:image" content="${image}">`,
      `<meta property="og:image:alt" content="${escapeHtml(title)}">`,
      `<meta name="twitter:card" content="summary_large_image">`,
      `<meta name="twitter:title" content="${escapeHtml(title)}">`,
      `<meta name="twitter:description" content="${escapeHtml(description)}">`,
      `<meta name="twitter:image" content="${image}">`
    ].join("\n    ");

    const out = html
      .replace(/<title>.*?<\/title>/i, `<title>${escapeHtml(title)}</title>`)
      .replace("</head>", `    ${tags}\n  </head>`);
    res.type("html").send(out);
  } catch (error) {
    next(error);
  }
});

app.use(express.static(publicDir));

app.use("/api", (req, res) => res.status(404).json({ error: "Rota não encontrada." }));

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: "Erro interno do servidor." });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Contribua rodando em http://localhost:${port}`);
});
