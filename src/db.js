import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não definida. Copie .env.example para .env.");
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const query = (text, params) => pool.query(text, params);
