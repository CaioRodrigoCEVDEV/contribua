import test from "node:test";
import assert from "node:assert/strict";

await import("../public/crm-send.js");
const { createSender } = globalThis.ContribuaCrm;

function fakeButton() {
  return {
    disabled: false,
    textContent: "Enviar ao CRM",
    attrs: {},
    clickHandler: null,
    addEventListener(type, handler) {
      if (type === "click") this.clickHandler = handler;
    },
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    click() {
      return this.clickHandler();
    }
  };
}

function fakeStatus() {
  return {
    hidden: true,
    textContent: "",
    classes: {},
    classList: {
      toggle(name, value) {
        this.owner.classes[name] = value;
      },
      owner: null
    }
  };
}

function makeStatus() {
  const status = fakeStatus();
  status.classList.owner = status;
  return status;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createHarness(message) {
  const button = fakeButton();
  const status = makeStatus();
  const calls = [];
  let handler;
  const api = async (path, options) => {
    calls.push({ path, options });
    return handler(path, options, calls.length);
  };
  const sender = createSender({
    api,
    button,
    status,
    getMessage: () => message.value
  });
  return {
    button,
    status,
    calls,
    sender,
    setHandler(fn) {
      handler = fn;
    }
  };
}

test("desabilita o botão durante o envio e impede cliques repetidos", async () => {
  const message = { value: "  Texto exato do textarea\nsegunda linha  " };
  const harness = createHarness(message);
  const pending = deferred();
  harness.setHandler(() => pending.promise);

  const first = harness.button.click();
  assert.equal(harness.button.disabled, true);
  assert.equal(harness.button.textContent, "Enviando...");
  assert.equal(harness.button.attrs["aria-busy"], "true");

  await harness.button.click();
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].path, "/api/integrations/crm/send");
  assert.equal(harness.calls[0].options.body.message, message.value);
  assert.match(harness.calls[0].options.body.idempotency_key, /^[0-9a-f-]{36}$/i);

  pending.resolve({ ok: true, status: "success" });
  await first;
  assert.equal(harness.button.disabled, false);
  assert.equal(harness.button.textContent, "Enviar ao CRM");
  assert.equal(harness.status.classes["is-success"], true);
});

test("mantém a mesma chave após resultado desconhecido", async () => {
  const message = { value: "Mensagem original" };
  const harness = createHarness(message);
  harness.setHandler((path, options, call) => {
    if (call === 1) throw new Error("timeout de rede");
    return { ok: true, status: "success" };
  });

  await harness.button.click();
  const firstKey = harness.calls[0].options.body.idempotency_key;
  assert.equal(harness.status.classes["is-error"], true);

  await harness.button.click();
  assert.equal(harness.calls[1].options.body.idempotency_key, firstKey);
  assert.equal(harness.status.classes["is-success"], true);
});

test("gera nova chave após erro confirmado pelo CRM", async () => {
  const message = { value: "Mensagem original" };
  const harness = createHarness(message);
  harness.setHandler((path, options, call) => {
    if (call === 1) {
      const error = new Error("Segredo inválido");
      error.status = 502;
      error.keep_idempotency_key = false;
      throw error;
    }
    return { ok: true, status: "success" };
  });

  await harness.button.click();
  await harness.button.click();
  assert.notEqual(
    harness.calls[0].options.body.idempotency_key,
    harness.calls[1].options.body.idempotency_key
  );
});

test("mantém a chave quando o CRM informa processamento", async () => {
  const message = { value: "Mensagem original" };
  const harness = createHarness(message);
  harness.setHandler((path, options, call) => {
    if (call === 1) return { ok: true, status: "processing" };
    return { ok: true, status: "success" };
  });

  await harness.button.click();
  assert.equal(harness.status.classes["is-info"], true);
  assert.match(harness.status.textContent, /processando/i);

  await harness.button.click();
  assert.equal(
    harness.calls[0].options.body.idempotency_key,
    harness.calls[1].options.body.idempotency_key
  );
});

test("não envia mensagem vazia e preserva o conteúdo em caso de erro", async () => {
  const message = { value: "   " };
  const harness = createHarness(message);
  harness.setHandler(() => ({ ok: true, status: "success" }));

  await harness.button.click();
  assert.equal(harness.calls.length, 0);
  assert.equal(harness.status.classes["is-error"], true);
  assert.equal(message.value, "   ");

  message.value = "Conteúdo preservado";
  harness.setHandler(() => {
    const error = new Error("Falha no CRM");
    error.status = 502;
    throw error;
  });
  await harness.button.click();
  assert.equal(message.value, "Conteúdo preservado");
  assert.equal(harness.status.textContent, "Falha no CRM");
});
