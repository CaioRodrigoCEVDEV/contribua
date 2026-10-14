import "dotenv/config";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express from "express";
import cookieParser from "cookie-parser";

import authRoutes from "./routes/auth.js";
import tableRoutes from "./routes/tables.js";
import publicRoutes from "./routes/public.js";
import settingsRoutes from "./routes/settings.js";
import { pool } from "./db.js";

process.on("unhandledRejection", (error) => console.error("Unhandled rejection:", error));
process.on("uncaughtException", (error) => console.error("Uncaught exception:", error));

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "public");

const app = express();
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

app.get("/dashboard", (req, res) => res.sendFile(join(publicDir, "dashboard.html")));
app.get("/t/:slug", (req, res) => res.sendFile(join(publicDir, "poster.html")));

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
