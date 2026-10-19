import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createUserStore, startServer, jsonRequest } from "./helpers.js";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "integrations-test-secret";
process.env.DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:5432/contribua_test";

const { createIntegrationsRouter } = await import("../src/routes/integrations.js");
const { signToken } = await import("../src/auth.js");
const { encryptSecret } = await import("../src/crypto.js");
const { sendCrmMessage } = await import("../src/crm.js");

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const INTEGRATION_A = "11111111-1111-4111-8111-111111111111";
const INTEGRATION_B = "22222222-2222-4222-8222-222222222222";
const ENDPOINT_A = `https://8.8.8.8/api/integrations/webhooks/${INTEGRATION_A}/execute`;
const ENDPOINT_B = `https://8.8.8.4/api/integrations/webhooks/${INTEGRATION_B}/execute`;
const SECRET_A = "whk_secret_a";
const SECRET_B = "whk_secret_b";

function auth(userId) {
  return { Authorization: `Bearer ${signToken(userId)}` };
}

function configuredUser(id, fields = {}) {
  return {
    id,
    crm_enabled: true,
    crm_endpoint_url: ENDPOINT_A,
    crm_secret: encryptSecret(SECRET_A),
    ...fields
  };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function captureFetch(handler) {
  const calls = [];
  async function fetchImpl(url, options) {
    calls.push({ url, options });
    return handler(url, options, calls.length);
  }
  return { calls, fetchImpl };
}

async function makeServer({ users = [configuredUser(USER_A), { id: USER_B }], fetchImpl, timeoutMs } = {}) {
  const store = createUserStore(users);
  const app = express();
  app.use(express.json());
  app.use(
    "/api/integrations",
    createIntegrationsRouter({
      query: store.query,
      send: (options) => sendCrmMessage({ ...options, fetchImpl, timeoutMs })
    })
  );
  const server = await startServer(app);
  return { store, server };
}

test("envia a mensagem editada ao CRM e normaliza o resultado", async () => {
  const { calls, fetchImpl } = captureFetch(() =>
    jsonResponse(200, {
      ok: true,
      executionId: "exec-1",
      status: "SUCCESS",
      externalMessageId: "wamid-1",
      messageId: "message-1",
      conversationId: "conversation-1"
    })
  );
  const { server } = await makeServer({ fetchImpl });
  try {
    const idempotencyKey = "33333333-3333-4333-8333-333333333333";
    const message = "Mensagem editada\ncom duas linhas 🎉";
    const result = await jsonRequest(`${server.base}/api/integrations/crm/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth(USER_A) },
      body: JSON.stringify({ message, idempotency_key: idempotencyKey })
    });

    assert.equal(result.status, 200);
    assert.equal(result.data.ok, true);
    assert.equal(result.data.status, "success");
    assert.equal(result.data.idempotency_key, idempotencyKey);
    assert.equal(result.data.execution.execution_id, "exec-1");
    assert.equal(result.text.includes(SECRET_A), false);

    assert.equal(calls[0].url, ENDPOINT_A);
    assert.equal(calls[0].options.headers.Authorization, `Bearer ${SECRET_A}`);
    assert.equal(calls[0].options.headers["Idempotency-Key"], idempotencyKey);
    assert.deepEqual(JSON.parse(calls[0].options.body), { message });
  } finally {
    await server.close();
  }
});

test("envia image_url ao CRM junto da mensagem editada", async () => {
  const { calls, fetchImpl } = captureFetch(() =>
    jsonResponse(200, { ok: true, status: "SUCCESS", executionId: "exec-image" })
  );
  const { server } = await makeServer({ fetchImpl });
  try {
    const result = await jsonRequest(`${server.base}/api/integrations/crm/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth(USER_A) },
      body: JSON.stringify({
        message: "Mensagem com imagem",
        image_url: "https://8.8.8.8/t/lista/og-image",
        idempotency_key: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
      })
    });

    assert.equal(result.status, 200);
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      message: "Mensagem com imagem",
      imageUrl: "https://8.8.8.8/t/lista/og-image"
    });
  } finally {
    await server.close();
  }
});

test("envia somente texto quando a imagem está desativada na configuração", async () => {
  const { calls, fetchImpl } = captureFetch(() =>
    jsonResponse(200, { ok: true, status: "SUCCESS" })
  );
  const { server } = await makeServer({
    users: [configuredUser(USER_A, { crm_send_image: false })],
    fetchImpl
  });
  try {
    const result = await jsonRequest(`${server.base}/api/integrations/crm/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth(USER_A) },
      body: JSON.stringify({
        message: "Somente texto",
        image_url: "https://8.8.8.8/t/lista/og-image",
        idempotency_key: "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb"
      })
    });

    assert.equal(result.status, 200);
    assert.deepEqual(JSON.parse(calls[0].options.body), { message: "Somente texto" });
  } finally {
    await server.close();
  }
});

test("rejeita image_url com tipo inválido", async () => {
  const { calls, fetchImpl } = captureFetch(() => jsonResponse(200, { ok: true }));
  const { server } = await makeServer({ fetchImpl });
  try {
    const result = await jsonRequest(`${server.base}/api/integrations/crm/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth(USER_A) },
      body: JSON.stringify({ message: "Olá", image_url: { url: "x" } })
    });
    assert.equal(result.status, 400);
    assert.equal(result.data.code, "CRM_IMAGE_URL_INVALID");
    assert.equal(calls.length, 0);
  } finally {
    await server.close();
  }
});

test("rejeita requisições sem sessão do Contribua", async () => {
  const { calls, fetchImpl } = captureFetch(() => jsonResponse(200, { ok: true }));
  const { server } = await makeServer({ fetchImpl });
  try {
    const result = await jsonRequest(`${server.base}/api/integrations/crm/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Olá" })
    });
    assert.equal(result.status, 401);
    assert.equal(calls.length, 0);
  } finally {
    await server.close();
  }
});

test("rejeita integração desativada ou incompleta sem chamar o CRM", async () => {
  const disabled = { id: USER_A, crm_enabled: false, crm_endpoint_url: ENDPOINT_A, crm_secret: encryptSecret(SECRET_A) };
  const incomplete = { id: USER_B, crm_enabled: true, crm_endpoint_url: ENDPOINT_A, crm_secret: "" };
  const { calls, fetchImpl } = captureFetch(() => jsonResponse(200, { ok: true }));
  const { server } = await makeServer({ users: [disabled, incomplete], fetchImpl });
  try {
    const disabledResult = await jsonRequest(`${server.base}/api/integrations/crm/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth(USER_A) },
      body: JSON.stringify({ message: "Olá" })
    });
    assert.equal(disabledResult.status, 409);
    assert.equal(disabledResult.data.code, "CRM_DISABLED");

    const incompleteResult = await jsonRequest(`${server.base}/api/integrations/crm/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth(USER_B) },
      body: JSON.stringify({ message: "Olá" })
    });
    assert.equal(incompleteResult.status, 409);
    assert.equal(incompleteResult.data.code, "CRM_NOT_CONFIGURED");
    assert.equal(calls.length, 0);
  } finally {
    await server.close();
  }
});

test("não utiliza a configuração de outro usuário", async () => {
  const { calls, fetchImpl } = captureFetch(() => jsonResponse(200, { ok: true, status: "SUCCESS" }));
  const { server } = await makeServer({
    users: [
      configuredUser(USER_A),
      configuredUser(USER_B, {
        crm_endpoint_url: ENDPOINT_B,
        crm_secret: encryptSecret(SECRET_B)
      })
    ],
    fetchImpl
  });
  try {
    const result = await jsonRequest(`${server.base}/api/integrations/crm/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth(USER_B) },
      body: JSON.stringify({
        message: "Mensagem do usuário B",
        idempotency_key: "44444444-4444-4444-8444-444444444444"
      })
    });
    assert.equal(result.status, 200);
    assert.equal(calls[0].url, ENDPOINT_B);
    assert.equal(calls[0].options.headers.Authorization, `Bearer ${SECRET_B}`);
  } finally {
    await server.close();
  }
});

test("traduz erros do CRM para o frontend", async () => {
  const cases = [
    [401, { code: "WEBHOOK_UNAUTHORIZED" }, 502, "CRM_UNAUTHORIZED"],
    [409, { code: "WEBHOOK_INTEGRATION_INACTIVE" }, 409, "CRM_INTEGRATION_INACTIVE"],
    [409, { code: "WEBHOOK_INSTANCE_UNAVAILABLE" }, 409, "CRM_INSTANCE_UNAVAILABLE"],
    [429, { code: "RATE_LIMITED" }, 429, "CRM_RATE_LIMITED"],
    [502, { code: "WEBHOOK_PROVIDER_ERROR" }, 502, "CRM_SEND_FAILED"]
  ];

  for (const [upstreamStatus, body, expectedStatus, expectedCode] of cases) {
    const { fetchImpl } = captureFetch(() => jsonResponse(upstreamStatus, body));
    const { server } = await makeServer({ fetchImpl });
    try {
      const result = await jsonRequest(`${server.base}/api/integrations/crm/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth(USER_A) },
        body: JSON.stringify({
          message: "Olá",
          idempotency_key: "55555555-5555-4555-8555-555555555555"
        })
      });
      assert.equal(result.status, expectedStatus, expectedCode);
      assert.equal(result.data.code, expectedCode);
      assert.equal(result.text.includes(SECRET_A), false);
    } finally {
      await server.close();
    }
  }
});

test("informa execução em processamento mantendo a chave", async () => {
  const idempotencyKey = "66666666-6666-4666-8666-666666666666";
  const { fetchImpl } = captureFetch(() =>
    jsonResponse(409, {
      code: "WEBHOOK_EXECUTION_IN_PROGRESS",
      details: { executionId: "exec-processing" }
    })
  );
  const { server } = await makeServer({ fetchImpl });
  try {
    const result = await jsonRequest(`${server.base}/api/integrations/crm/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth(USER_A) },
      body: JSON.stringify({ message: "Olá", idempotency_key: idempotencyKey })
    });
    assert.equal(result.status, 202);
    assert.equal(result.data.status, "processing");
    assert.equal(result.data.idempotency_key, idempotencyKey);
    assert.equal(result.data.execution.execution_id, "exec-processing");
  } finally {
    await server.close();
  }
});

test("trata timeout e falha de rede sem afirmar que a mensagem não foi enviada", async () => {
  const timeoutKey = "77777777-7777-4777-8777-777777777777";
  const timeoutServer = await makeServer({
    timeoutMs: 20,
    fetchImpl: (url, options) =>
      new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      })
  });
  try {
    const result = await jsonRequest(`${timeoutServer.server.base}/api/integrations/crm/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth(USER_A) },
      body: JSON.stringify({ message: "Olá", idempotency_key: timeoutKey })
    });
    assert.equal(result.status, 504);
    assert.equal(result.data.code, "CRM_TIMEOUT");
    assert.equal(result.data.keep_idempotency_key, true);
    assert.equal(result.data.unknown_result, true);
    assert.equal(result.data.idempotency_key, timeoutKey);
  } finally {
    await timeoutServer.server.close();
  }

  const networkServer = await makeServer({
    fetchImpl: async () => {
      throw new TypeError("fetch failed");
    }
  });
  try {
    const result = await jsonRequest(`${networkServer.server.base}/api/integrations/crm/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth(USER_A) },
      body: JSON.stringify({ message: "Olá", idempotency_key: timeoutKey })
    });
    assert.equal(result.status, 502);
    assert.equal(result.data.code, "CRM_NETWORK_ERROR");
    assert.equal(result.data.keep_idempotency_key, true);
    assert.equal(result.data.idempotency_key, timeoutKey);
  } finally {
    await networkServer.server.close();
  }
});

test("reutiliza a mesma chave de idempotência em nova tentativa", async () => {
  const idempotencyKey = "88888888-8888-4888-8888-888888888888";
  const { calls, fetchImpl } = captureFetch((url, options, call) => {
    if (call === 1) throw new TypeError("fetch failed");
    return jsonResponse(200, { ok: true, status: "SUCCESS", executionId: "exec-retry" });
  });
  const { server } = await makeServer({ fetchImpl });
  try {
    const first = await jsonRequest(`${server.base}/api/integrations/crm/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth(USER_A) },
      body: JSON.stringify({ message: "Olá", idempotency_key: idempotencyKey })
    });
    assert.equal(first.status, 502);

    const retryKey = first.data.idempotency_key;
    const second = await jsonRequest(`${server.base}/api/integrations/crm/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth(USER_A) },
      body: JSON.stringify({ message: "Olá", idempotency_key: retryKey })
    });
    assert.equal(second.status, 200);
    assert.equal(calls[0].options.headers["Idempotency-Key"], idempotencyKey);
    assert.equal(calls[1].options.headers["Idempotency-Key"], idempotencyKey);
  } finally {
    await server.close();
  }
});

test("valida o limite de 4096 caracteres antes de chamar o CRM", async () => {
  const { calls, fetchImpl } = captureFetch(() => jsonResponse(200, { ok: true }));
  const { server } = await makeServer({ fetchImpl });
  try {
    const result = await jsonRequest(`${server.base}/api/integrations/crm/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth(USER_A) },
      body: JSON.stringify({ message: "x".repeat(4097) })
    });
    assert.equal(result.status, 400);
    assert.equal(result.data.code, "CRM_MESSAGE_TOO_LONG");
    assert.equal(calls.length, 0);
  } finally {
    await server.close();
  }
});
