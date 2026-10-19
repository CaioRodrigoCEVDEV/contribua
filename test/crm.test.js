import test from "node:test";
import assert from "node:assert/strict";
import {
  CrmSendError,
  CrmValidationError,
  normalizeCrmEndpoint,
  normalizeIdempotencyKey,
  normalizeImageUrl,
  sendCrmMessage
} from "../src/crm.js";

const INTEGRATION_ID = "11111111-1111-4111-8111-111111111111";
const ENDPOINT = `https://8.8.8.8/api/integrations/webhooks/${INTEGRATION_ID}/execute`;
const SECRET = "whk_secret_value";

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

test("valida a URL completa do webhook e exige HTTPS em produção", async () => {
  const normalized = await normalizeCrmEndpoint(ENDPOINT);
  assert.equal(normalized, ENDPOINT);

  await assert.rejects(
    normalizeCrmEndpoint(ENDPOINT.replace("https:", "http:"), { requireHttps: true }),
    (error) => error instanceof CrmValidationError && error.code === "CRM_URL_HTTPS_REQUIRED"
  );
});

test("rejeita destinos privados, credenciais, caminho errado e /api duplicado", async () => {
  const cases = [
    [`https://127.0.0.1/api/integrations/webhooks/${INTEGRATION_ID}/execute`, "CRM_URL_PRIVATE"],
    [`https://192.168.1.10/api/integrations/webhooks/${INTEGRATION_ID}/execute`, "CRM_URL_PRIVATE"],
    [`https://localhost/api/integrations/webhooks/${INTEGRATION_ID}/execute`, "CRM_URL_PRIVATE"],
    [`https://[::1]/api/integrations/webhooks/${INTEGRATION_ID}/execute`, "CRM_URL_PRIVATE"],
    [`https://[::ffff:192.168.1.20]/api/integrations/webhooks/${INTEGRATION_ID}/execute`, "CRM_URL_PRIVATE"],
    [`https://user:pass@8.8.8.8/api/integrations/webhooks/${INTEGRATION_ID}/execute`, "CRM_URL_CREDENTIALS"],
    [`https://8.8.8.8/integrations/webhooks/${INTEGRATION_ID}/execute`, "CRM_URL_PATH_INVALID"],
    [`https://8.8.8.8/api/api/integrations/webhooks/${INTEGRATION_ID}/execute`, "CRM_URL_PATH_INVALID"]
  ];

  for (const [url, code] of cases) {
    await assert.rejects(
      normalizeCrmEndpoint(url),
      (error) => error instanceof CrmValidationError && error.code === code,
      url
    );
  }
});

test("bloqueia hostnames que resolvem para endereços privados", async () => {
  await assert.rejects(
    normalizeCrmEndpoint(`https://crm.example.com/api/integrations/webhooks/${INTEGRATION_ID}/execute`, {
      lookup: async () => [{ address: "10.0.0.8", family: 4 }]
    }),
    (error) => error instanceof CrmValidationError && error.code === "CRM_URL_PRIVATE"
  );
});

test("envia exatamente o texto editado, com headers e payload do contrato", async () => {
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
  const message = "  Texto editado pelo usuário\ncom quebras de linha e emojis 🎉  ";
  const idempotencyKey = "22222222-2222-4222-8222-222222222222";

  const result = await sendCrmMessage({
    endpoint: ENDPOINT,
    secret: SECRET,
    message,
    idempotencyKey,
    fetchImpl
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ENDPOINT);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${SECRET}`);
  assert.equal(calls[0].options.headers["Idempotency-Key"], idempotencyKey);
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].options.body), { message });
  assert.equal(result.status, "success");
  assert.deepEqual(result.execution, {
    execution_id: "exec-1",
    status: "SUCCESS",
    external_message_id: "wamid-1",
    message_id: "message-1",
    conversation_id: "conversation-1"
  });
});

test("envia imageUrl junto da mensagem quando informado", async () => {
  const { calls, fetchImpl } = captureFetch(() =>
    jsonResponse(200, { ok: true, status: "SUCCESS" })
  );
  const imageUrl = "https://8.8.8.8/t/lista/og-image?v=1";

  const result = await sendCrmMessage({
    endpoint: ENDPOINT,
    secret: SECRET,
    message: "Mensagem com imagem",
    imageUrl,
    idempotencyKey: "99999999-9999-4999-8999-999999999999",
    fetchImpl
  });

  assert.deepEqual(JSON.parse(calls[0].options.body), {
    message: "Mensagem com imagem",
    imageUrl
  });
  assert.equal(result.status, "success");
});

test("valida a URL pública da imagem antes do envio", async () => {
  assert.equal(
    await normalizeImageUrl("https://8.8.8.8/t/lista/og-image?v=1"),
    "https://8.8.8.8/t/lista/og-image?v=1"
  );
  await assert.rejects(
    normalizeImageUrl("https://127.0.0.1/t/lista/og-image"),
    (error) => error instanceof CrmValidationError && error.code === "CRM_URL_PRIVATE"
  );
  await assert.rejects(
    normalizeImageUrl("file:///etc/passwd"),
    (error) => error instanceof CrmValidationError
  );
});

test("gera UUID quando a chave de idempotência não é informada", async () => {
  const { calls, fetchImpl } = captureFetch(() => jsonResponse(200, { ok: true, status: "SUCCESS" }));
  const result = await sendCrmMessage({
    endpoint: ENDPOINT,
    secret: SECRET,
    message: "Olá",
    fetchImpl
  });
  assert.match(calls[0].options.headers["Idempotency-Key"], /^[0-9a-f-]{36}$/i);
  assert.equal(result.idempotency_key, calls[0].options.headers["Idempotency-Key"]);
  assert.throws(() => normalizeIdempotencyKey("nao-e-uuid"), CrmSendError);
});

test("mapeia sucesso, processamento e erros do CRM", async () => {
  const processing = await sendCrmMessage({
    endpoint: ENDPOINT,
    secret: SECRET,
    message: "Olá",
    idempotencyKey: "33333333-3333-4333-8333-333333333333",
    fetchImpl: async () =>
      jsonResponse(409, {
        code: "WEBHOOK_EXECUTION_IN_PROGRESS",
        message: "Em andamento",
        details: { executionId: "exec-processing" }
      })
  });
  assert.equal(processing.status, "processing");
  assert.equal(processing.execution.execution_id, "exec-processing");

  const errors = [
    [401, { code: "WEBHOOK_UNAUTHORIZED" }, "CRM_UNAUTHORIZED", 502],
    [409, { code: "WEBHOOK_INTEGRATION_INACTIVE" }, "CRM_INTEGRATION_INACTIVE", 409],
    [409, { code: "WEBHOOK_INSTANCE_UNAVAILABLE" }, "CRM_INSTANCE_UNAVAILABLE", 409],
    [429, { code: "RATE_LIMITED" }, "CRM_RATE_LIMITED", 429],
    [502, { code: "WEBHOOK_PROVIDER_ERROR" }, "CRM_SEND_FAILED", 502],
    [503, { code: "WEBHOOK_PROVIDER_UNAVAILABLE" }, "CRM_UNAVAILABLE", 503],
    [502, { code: "WEBHOOK_EXECUTION_FAILED" }, "CRM_EXECUTION_FAILED", 502]
  ];

  for (const [status, body, expectedCode, expectedStatus] of errors) {
    await assert.rejects(
      sendCrmMessage({
        endpoint: ENDPOINT,
        secret: SECRET,
        message: "Olá",
        idempotencyKey: "44444444-4444-4444-8444-444444444444",
        fetchImpl: async () => jsonResponse(status, body)
      }),
      (error) =>
        error instanceof CrmSendError &&
        error.code === expectedCode &&
        error.httpStatus === expectedStatus,
      expectedCode
    );
  }
});

test("trata timeout e falha de rede como resultado desconhecido", async () => {
  const timeoutKey = "55555555-5555-4555-8555-555555555555";
  await assert.rejects(
    sendCrmMessage({
      endpoint: ENDPOINT,
      secret: SECRET,
      message: "Olá",
      idempotencyKey: timeoutKey,
      timeoutMs: 20,
      fetchImpl: (url, options) =>
        new Promise((resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        })
    }),
    (error) =>
      error instanceof CrmSendError &&
      error.code === "CRM_TIMEOUT" &&
      error.httpStatus === 504 &&
      error.keepIdempotencyKey === true &&
      error.unknownResult === true &&
      error.idempotencyKey === timeoutKey
  );

  const networkKey = "66666666-6666-4666-8666-666666666666";
  await assert.rejects(
    sendCrmMessage({
      endpoint: ENDPOINT,
      secret: SECRET,
      message: "Olá",
      idempotencyKey: networkKey,
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      }
    }),
    (error) =>
      error instanceof CrmSendError &&
      error.code === "CRM_NETWORK_ERROR" &&
      error.keepIdempotencyKey === true &&
      error.idempotencyKey === networkKey
  );
});

test("valida mensagem vazia, limite de 4096 e JSON de resposta", async () => {
  const base = {
    endpoint: ENDPOINT,
    secret: SECRET,
    fetchImpl: async () => jsonResponse(200, { ok: true, status: "SUCCESS" })
  };

  await assert.rejects(
    sendCrmMessage({ ...base, message: "   " }),
    (error) => error.code === "CRM_MESSAGE_REQUIRED"
  );
  await assert.rejects(
    sendCrmMessage({ ...base, message: "x".repeat(4097) }),
    (error) => error.code === "CRM_MESSAGE_TOO_LONG"
  );
  await assert.rejects(
    sendCrmMessage({
      ...base,
      message: "Olá",
      fetchImpl: async () => new Response("not-json", { status: 200 })
    }),
    (error) => error.code === "CRM_INVALID_RESPONSE"
  );
});
