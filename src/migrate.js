import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pool } from "./db.js";

const here = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const sql = await readFile(join(here, "schema.sql"), "utf8");
  await pool.query(sql);
  console.log("Migração concluída: schema aplicado.");
  await pool.end();
}

migrate().catch((error) => {
  console.error("Falha na migração:", error.message);
  process.exit(1);
});
