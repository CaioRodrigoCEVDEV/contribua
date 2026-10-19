import { once } from "node:events";

function userRow(id, fields = {}) {
  return {
    id,
    name: `User ${id}`,
    email: `${id}@example.com`,
    password_hash: "hash",
    openai_key: "",
    openai_model: "",
    openai_base_url: "",
    crm_enabled: false,
    crm_endpoint_url: "",
    crm_secret: "",
    crm_send_image: true,
    ...fields
  };
}

export function createUserStore(users = []) {
  const rows = new Map();
  for (const user of users) {
    rows.set(user.id, userRow(user.id, user));
  }
  const calls = [];

  async function query(text, params = []) {
    const sql = String(text).replace(/\s+/g, " ").trim();
    calls.push({ sql, params });

    if (/^SELECT .* FROM users WHERE id = \$1$/i.test(sql)) {
      const row = rows.get(params[0]);
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }

    if (/^UPDATE users SET /i.test(sql)) {
      const whereIndex = sql.toUpperCase().indexOf(" WHERE ");
      const setPart = sql.slice("UPDATE users SET ".length, whereIndex);
      const assignments = setPart.split(",").map((part) => part.trim());
      const userId = params[params.length - 1];
      const row = rows.get(userId);
      if (!row) return { rows: [], rowCount: 0 };
      assignments.forEach((assignment, index) => {
        const column = assignment.split("=")[0].trim();
        row[column] = params[index];
      });
      return { rows: [{ ...row }], rowCount: 1 };
    }

    throw new Error(`Unsupported query in test: ${sql}`);
  }

  return {
    query,
    calls,
    rows,
    get(id) {
      return rows.get(id);
    }
  };
}

export async function startServer(app) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return {
    base: `http://127.0.0.1:${address.port}`,
    async close() {
      server.close();
      await once(server, "close");
    }
  };
}

export async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { response, status: response.status, data, text };
}
