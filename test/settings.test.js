import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createUserStore, startServer, jsonRequest } from "./helpers.js";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "settings-test-secret";
process.env.DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:5432/contribua_test";

const { createSettingsRouter } = await import("../src/routes/settings.js");
const { signToken } = await import("../src/auth.js");

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const INTEGRATION_ID = "11111111-1111-4111-8111-111111111111";
const ENDPOINT = `https://8.8.8.8/api/integrations/webhooks/${INTEGRATION_ID}/execute`;
const SECRET = "whk_settings_secret_123";

function auth(userId) {
  return { Authorization: `Bearer ${signToken(userId)}` };
}

async function makeServer() {
  const store = createUserStore([{ id: USER_A }, { id: USER_B }]);
  const app = express();
  app.use(express.json());
  app.use("/api/settings", createSettingsRouter({ query: store.query }));
  const server = await startServer(app);
  return { store, server };
}

test("salva e recupera a configuração do CRM por usuário", async () => {
  const { store, server } = await makeServer();
  try {
    const saved = await jsonRequest(`${server.base}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...auth(USER_A) },
      body: JSON.stringify({
        crm_enabled: true,
        crm_endpoint_url: ENDPOINT,
        crm_secret: SECRET
      })
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.crm.enabled, true);
    assert.equal(saved.data.crm.configured, true);
    assert.equal(saved.data.crm.endpoint_url, ENDPOINT);

    const stored = store.get(USER_A);
    assert.equal(stored.crm_enabled, true);
    assert.equal(stored.crm_endpoint_url, ENDPOINT);
    assert.notEqual(stored.crm_secret, SECRET);
    assert.ok(stored.crm_secret.length > SECRET.length);

    const loaded = await jsonRequest(`${server.base}/api/settings`, {
      headers: auth(USER_A)
    });
    assert.equal(loaded.status, 200);
    assert.equal(loaded.data.settings.crm.enabled, true);
    assert.equal(loaded.data.settings.crm.configured, true);
    assert.equal(loaded.data.settings.crm.endpoint_url, ENDPOINT);
    assert.equal(loaded.data.settings.crm.has_secret, true);
    assert.equal(loaded.data.settings.crm.status, "ready");

    const other = await jsonRequest(`${server.base}/api/settings`, {
      headers: auth(USER_B)
    });
    assert.equal(other.data.settings.crm.enabled, false);
    assert.equal(other.data.settings.crm.endpoint_url, "");
    assert.equal(other.data.settings.crm.has_secret, false);
    assert.equal(other.data.settings.crm.configured, false);
  } finally {
    await server.close();
  }
});

test("nunca devolve o segredo do CRM em texto aberto", async () => {
  const { server } = await makeServer();
  try {
    await jsonRequest(`${server.base}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...auth(USER_A) },
      body: JSON.stringify({
        crm_enabled: true,
        crm_endpoint_url: ENDPOINT,
        crm_secret: SECRET
      })
    });

    const loaded = await jsonRequest(`${server.base}/api/settings`, {
      headers: auth(USER_A)
    });
    assert.equal(loaded.text.includes(SECRET), false);
    assert.equal(loaded.data.settings.crm.masked_secret, "••••••••");
  } finally {
    await server.close();
  }
});

test("mantém o segredo quando ele não é reenviado", async () => {
  const { store, server } = await makeServer();
  try {
    await jsonRequest(`${server.base}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...auth(USER_A) },
      body: JSON.stringify({
        crm_enabled: true,
        crm_endpoint_url: ENDPOINT,
        crm_secret: SECRET
      })
    });
    const encrypted = store.get(USER_A).crm_secret;

    const updated = await jsonRequest(`${server.base}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...auth(USER_A) },
      body: JSON.stringify({
        crm_enabled: true,
        crm_endpoint_url: ENDPOINT
      })
    });
    assert.equal(updated.status, 200);
    assert.equal(store.get(USER_A).crm_secret, encrypted);
    assert.equal(updated.data.crm.has_secret, true);
  } finally {
    await server.close();
  }
});

test("rejeita configuração incompleta e URL inválida", async () => {
  const { server } = await makeServer();
  try {
    const incomplete = await jsonRequest(`${server.base}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...auth(USER_B) },
      body: JSON.stringify({ crm_enabled: true, crm_endpoint_url: ENDPOINT })
    });
    assert.equal(incomplete.status, 400);
    assert.equal(incomplete.data.code, "CRM_CONFIG_INCOMPLETE");

    const invalid = await jsonRequest(`${server.base}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...auth(USER_B) },
      body: JSON.stringify({
        crm_enabled: false,
        crm_endpoint_url: `https://127.0.0.1/api/integrations/webhooks/${INTEGRATION_ID}/execute`,
        crm_secret: SECRET
      })
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.data.code, "CRM_URL_PRIVATE");
  } finally {
    await server.close();
  }
});

test("rejeita acesso às configurações sem autenticação", async () => {
  const { server } = await makeServer();
  try {
    const getResponse = await jsonRequest(`${server.base}/api/settings`);
    assert.equal(getResponse.status, 401);

    const putResponse = await jsonRequest(`${server.base}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ crm_enabled: false })
    });
    assert.equal(putResponse.status, 401);
  } finally {
    await server.close();
  }
});
