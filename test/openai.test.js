import test from "node:test";
import assert from "node:assert/strict";
import { buildDraft, isContributionComplete } from "../src/openai.js";

function baseData(overrides = {}) {
  return {
    title: "Espaço Mirante",
    subtitle: "Natal 2026",
    installmentLabel: "2ª PARCELA",
    installmentDue: "20/10/2026",
    installmentCents: 5313,
    totalGoalCents: 85000,
    pixName: "Júlia",
    pixKey: "084.165.811-00",
    totalParticipants: 16,
    paidParticipants: 14,
    pendingParticipants: 2,
    receivedCents: 14 * 5313,
    pendingCents: 2 * 5313,
    link: "https://contribua.example.com/t/espaco-mirante",
    ...overrides
  };
}

test("detecta quando a contribuição está 100% concluída", () => {
  assert.equal(isContributionComplete(baseData()), false);
  assert.equal(
    isContributionComplete(
      baseData({
        paidParticipants: 16,
        pendingParticipants: 0,
        receivedCents: 16 * 5313,
        pendingCents: 0
      })
    ),
    true
  );
  assert.equal(
    isContributionComplete(baseData({ totalParticipants: 0, paidParticipants: 0, pendingParticipants: 0 })),
    false
  );
});

test("gera versões diferentes para a mensagem de atualização", () => {
  const data = baseData();
  const classic = buildDraft(data, "classica");
  const animated = buildDraft(data, "animada");
  const direct = buildDraft(data, "direta");

  assert.notEqual(classic, animated);
  assert.notEqual(animated, direct);
  assert.notEqual(classic, direct);

  for (const message of [classic, animated, direct]) {
    assert.match(message, /Falta arrecadar/);
    assert.match(message, /PIX — Júlia/);
    assert.match(message, /084\.165\.811-00/);
    assert.match(message, /https:\/\/contribua\.example\.com\/t\/espaco-mirante/);
  }
});

test("gera mensagem de finalização quando todos já pagaram", () => {
  const data = baseData({
    paidParticipants: 16,
    pendingParticipants: 0,
    receivedCents: 16 * 5313,
    pendingCents: 0
  });

  const festive = buildDraft(data, "festiva");
  const warm = buildDraft(data, "calorosa");
  const direct = buildDraft(data, "direta");

  assert.notEqual(festive, warm);
  assert.notEqual(warm, direct);

  for (const message of [festive, warm, direct]) {
    assert.match(message, /100%/);
    assert.match(message, /Pendentes: 0/);
    assert.match(message, /obrigado/i);
    assert.match(message, /https:\/\/contribua\.example\.com\/t\/espaco-mirante/);
    assert.doesNotMatch(message, /Falta arrecadar/);
    assert.doesNotMatch(message, /Quem ainda não pagou/);
    assert.doesNotMatch(message, /PIX —/);
  }
});
