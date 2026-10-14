import { query } from "./db.js";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomSuffix(length = 5) {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export function slugify(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export async function uniqueSlug(title) {
  const base = slugify(title) || "tabela";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `${base}-${randomSuffix()}`;
    const { rowCount } = await query("SELECT 1 FROM payment_tables WHERE slug = $1", [candidate]);
    if (rowCount === 0) return candidate;
  }
  return `${base}-${randomSuffix(10)}`;
}
