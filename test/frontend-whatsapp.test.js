import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

test("mantém o botão e o fluxo original de envio pelo WhatsApp", async () => {
  const dashboard = await readFile(join(root, "public", "dashboard.js"), "utf8");
  assert.match(dashboard, /data-role="whatsapp"/);
  assert.match(dashboard, /const text = textarea\.value;/);
  assert.match(dashboard, /https:\/\/wa\.me\//);
  assert.match(dashboard, /https:\/\/web\.whatsapp\.com\/send/);
  assert.match(dashboard, /data-role="crm"/);
  assert.match(dashboard, /window\.ContribuaCrm\.createSender/);
});

test("inclui os campos da integração na tela de configurações", async () => {
  const html = await readFile(join(root, "public", "dashboard.html"), "utf8");
  assert.match(html, /name="crm_enabled"/);
  assert.match(html, /name="crm_endpoint_url"/);
  assert.match(html, /name="crm_secret"/);
  assert.match(html, /Integração com CRM/);
  assert.match(html, /<script src="crm-send\.js"><\/script>/);
});

test("adiciona o controlador do CRM ao cache do service worker", async () => {
  const sw = await readFile(join(root, "public", "sw.js"), "utf8");
  assert.match(sw, /"\/crm-send\.js"/);
  assert.match(sw, /contribua-v3/);
});
