const DEFAULT_BASE_URL = "https://api.openai.com/v1";

function brl(cents) {
  return (Number(cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const SYSTEM_PROMPT = `Você escreve mensagens curtas e simpáticas para grupos de WhatsApp, em português do Brasil,
atualizando os participantes sobre o andamento de uma vaquinha/contribuição.
Regras:
- Use EXATAMENTE os números e valores informados. Nunca invente nem recalcule valores.
- Use emojis com moderação, no estilo das mensagens de organização de vaquinha.
- Estrutura: saudação, contexto do evento, valores (total, participantes, valor por pessoa, recebido, faltante),
  agradecimento a quem pagou, pedido de pagamento pelo PIX com nome e chave, e uma despedida amigável.
- Não use markdown nem blocos de código. Retorne apenas o texto final, pronto para enviar.`;

function buildUserPrompt(data) {
  const lines = [
    `Contexto da tabela:`,
    `- Título: ${data.title || "-"}`,
    `- Evento / subtítulo: ${data.subtitle || "-"}`,
    `- Rótulo da parcela: ${data.installmentLabel || "1ª PARCELA"}`,
    data.installmentDue ? `- Vencimento: ${data.installmentDue}` : null,
    `- Valor total: ${brl(data.totalGoalCents)}`,
    `- Valor por pessoa: ${brl(data.installmentCents)}`,
    `- Total de participantes: ${data.totalParticipants}`,
    `- Já pagaram: ${data.paidParticipants}`,
    `- Ainda não pagaram: ${data.pendingParticipants}`,
    `- Valor recebido até o momento: ${brl(data.receivedCents)}`,
    `- Falta arrecadar (da parcela): ${brl(data.pendingCents)}`,
    `- Nome do beneficiário do PIX: ${data.pixName || "-"}`,
    `- Chave PIX: ${data.pixKey || "-"}`,
    "",
    "Gere a mensagem de atualização para enviar no grupo do WhatsApp."
  ];
  return lines.filter((line) => line !== null).join("\n");
}

export async function generateWhatsappMessage({ apiKey, baseUrl, model, data }) {
  if (!apiKey) throw new Error("API key não configurada.");

  const url = `${(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "")}/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || "gpt-4o-mini",
      temperature: 0.7,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(data) }
      ]
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const status = response.status;
    const hint = status === 401 ? "Verifique a API key em Configurações." : detail.slice(0, 200);
    throw new Error(`Falha ao gerar a mensagem (${status}). ${hint}`);
  }

  const json = await response.json();
  const raw = json?.choices?.[0]?.message?.content;
  if (!raw) throw new Error("A IA não retornou nenhuma mensagem.");
  return String(raw).trim().replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
}
