const DEFAULT_BASE_URL = "https://api.openai.com/v1";

function brl(cents) {
  return (Number(cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const SYSTEM_PROMPT = `Você escreve mensagens de atualização de vaquinha/contribuição para grupos de WhatsApp, em português do Brasil.

Regras obrigatórias:
- A mensagem é feita de várias linhas curtas, NUNCA um parágrafo corrido.
- Cada informação numérica fica em sua própria linha, no formato "EMOJI Rótulo: VALOR".
- Separe os blocos com uma linha em branco.
- Preserve EXATAMENTE todos os números, valores, emojis, nomes e o link no final.
- Não use markdown (sem *, # ou crases). Retorne apenas a mensagem final.`;

function buildDraft(data) {
  const label = data.installmentLabel || "1ª PARCELA";
  const event = [data.title, data.subtitle].filter(Boolean).join(" — ") || "nossa contribuição";
  const lines = [
    "Fala, pessoal! 🎄🏡",
    "",
    `Passando para atualizar vocês sobre os pagamentos de ${event}.`,
    "",
    `💰 Valor total: ${brl(data.totalGoalCents)}`,
    `👥 Participantes: ${data.totalParticipants} pessoas`,
    `💵 ${label} por pessoa: ${brl(data.installmentCents)}`,
    "",
    `✅ Valor recebido até o momento: ${brl(data.receivedCents)}`,
    `❗ Falta arrecadar: ${brl(data.pendingCents)}`,
    "",
    "Obrigado a quem já realizou o pagamento! 🙏",
    "",
    "Quem ainda não pagou, peço que faça o PIX dentro do prazo e me avise para que eu possa atualizar nosso controle.",
    "",
    `🤑 PIX — ${data.pixName || "-"}`,
    `🔑 ${data.pixKey || "-"}`,
    "",
    `Vamos manter tudo organizado para aproveitarmos ${data.subtitle || "tudo"} juntos! 🎉`
  ];
  if (data.link) {
    lines.push("", "📲 Acompanhe a lista e veja quem já pagou:", data.link);
  }
  return lines.join("\n");
}

function withLink(message, link) {
  if (!link || message.includes(link)) return message;
  return `${message}\n\n📲 Acompanhe a lista e veja quem já pagou:\n${link}`;
}

function buildUserPrompt(data, draft) {
  return [
    "Deixe a mensagem abaixo mais natural e simpática para enviar no grupo do WhatsApp.",
    "",
    "Regras:",
    "- Mantenha EXATAMENTE a mesma estrutura: cada informação em sua própria linha, com uma linha em branco entre os blocos.",
    "- NÃO junte tudo em um único parágrafo.",
    "- Preserve TODOS os números, valores, emojis, nomes e o link no final sem alteração.",
    "- Você pode ajustar as frases de saudação, contexto e despedida, mas mantenha o mesmo sentido.",
    "- Não use markdown.",
    "",
    "Mensagem:",
    '"""',
    draft,
    '"""',
    "",
    "Retorne apenas a mensagem final, pronta para enviar."
  ].join("\n");
}

export async function generateWhatsappMessage({ apiKey, baseUrl, model, data }) {
  if (!apiKey) throw new Error("API key não configurada.");

  const draft = buildDraft(data);
  const url = `${(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "")}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model || "gpt-5.6-luna",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(data, draft) }
        ]
      })
    });
  } catch (error) {
    const reason = error?.name === "AbortError"
      ? "O provedor de IA demorou demais para responder."
      : "Não foi possível contatar o provedor de IA. Verifique a API key e a Base URL em Configurações.";
    throw new Error(reason);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    let detail = bodyText.slice(0, 300);
    try {
      const parsed = JSON.parse(bodyText);
      detail = parsed?.error?.message || detail;
    } catch { /* mantém o texto bruto */ }
    if (response.status === 401) detail = "API key inválida. Verifique em Configurações.";
    console.error(`[openai] ${response.status}: ${detail}`);
    throw new Error(`Falha ao gerar a mensagem (${response.status}). ${detail}`);
  }

  const json = await response.json();
  const raw = json?.choices?.[0]?.message?.content;
  if (!raw) return withLink(draft, data.link);

  let message = String(raw).trim().replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
  const enoughLines = message.split("\n").filter((line) => line.trim()).length >= 6;
  if (!enoughLines) message = draft;
  return withLink(message, data.link);
}
