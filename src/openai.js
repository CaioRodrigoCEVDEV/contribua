const DEFAULT_BASE_URL = "https://api.openai.com/v1";

function brl(cents) {
  return (Number(cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const UPDATE_STYLES = [
  {
    key: "classica",
    tone: "natural e simpática",
    greeting: "Fala, pessoal! 🎄🏡",
    intro: (event) => `Passando para atualizar vocês sobre os pagamentos de ${event}.`,
    thanks: "Obrigado a quem já realizou o pagamento! 🙏",
    pending: "Quem ainda não pagou, peço que faça o PIX dentro do prazo e me avise para que eu possa atualizar nosso controle.",
    closing: (event) => `Vamos manter tudo organizado para aproveitarmos ${event} juntos! 🎉`
  },
  {
    key: "animada",
    tone: "animada e entusiasmada",
    greeting: "Oi, gente! Tudo bem? ✨",
    intro: (event) => `Hora de atualizar a vaquinha de ${event}! 🚀`,
    thanks: "Gratidão a cada pessoa que já contribuiu! 💚",
    pending: "Ainda falta a contribuição de algumas pessoas. Se for você, faz o PIX e me avisa, combinado?",
    closing: (event) => `Bora fechar essa conta e comemorar ${event} juntos! 🎊`
  },
  {
    key: "direta",
    tone: "curta, direta e objetiva",
    greeting: "Atualização rápida! 📢",
    intro: (event) => `Resumo dos pagamentos de ${event}:`,
    thanks: "Valeu a quem já contribuiu! 👏",
    pending: "Quem ainda está pendente, pode fazer o PIX e avisar por aqui.",
    closing: (event) => `Qualquer dúvida, me chama. Vamos concluir ${event} sem pendências!`
  },
  {
    key: "calorosa",
    tone: "calorosa e acolhedora",
    greeting: "Oi, pessoal! Espero que todos estejam bem 💛",
    intro: (event) => `Vim compartilhar o andamento da nossa contribuição para ${event}.`,
    thanks: "Muito obrigado por cada gesto e por quem já contribuiu com carinho! 🙏",
    pending: "Se ainda faltar a sua contribuição, faça o PIX quando puder e me avise, por favor.",
    closing: (event) => `Juntos vamos tornar ${event} ainda mais especial! 💚`
  },
  {
    key: "descontraida",
    tone: "descontraída, leve e com bom humor",
    greeting: "E aí, pessoal! 😄",
    intro: (event) => `Chegou a atualização da nossa vaquinha para ${event}.`,
    thanks: "Já quero mandar um salve para quem pagou! Vocês são demais! 🙌",
    pending: "Se o seu PIX ainda está no modo avião, essa é a hora de decolar. Depois me avisa, beleza?",
    closing: (event) => `Vamos deixar ${event} pronto e sem pendência! 🚀`
  }
];

const COMPLETE_STYLES = [
  {
    key: "festiva",
    tone: "festiva e comemorativa",
    headline: "🎉 CONTRIBUIÇÃO 100% CONCLUÍDA! 🎉",
    greeting: "Fala, pessoal! Temos uma ótima notícia!",
    intro: (event) => `A vaquinha de ${event} foi concluída e todas as contribuições já foram recebidas!`,
    thanks: "Muito obrigado a cada pessoa que participou e ajudou a tornar isso possível! 🙏💚",
    closing: "Missão cumprida! 🏆"
  },
  {
    key: "calorosa",
    tone: "calorosa, emocionada e agradecida",
    headline: "✅ Tudo pago! Que alegria!",
    greeting: "Oi, gente!",
    intro: (event) => `Nossa contribuição para ${event} chegou a 100% e não há mais ninguém pendente.`,
    thanks: "Gratidão a todos que contribuíram com carinho e compromisso. Vocês são demais! 💛",
    closing: "Obrigado por fazerem parte dessa conquista. 🎉"
  },
  {
    key: "direta",
    tone: "curta, direta e com tom de conquista",
    headline: "✅ Contribuição concluída: 100%",
    greeting: "Atualização final:",
    intro: (event) => `A vaquinha de ${event} foi concluída. Todos os participantes já pagaram.`,
    thanks: "Obrigado a todos que contribuíram! 🙏",
    closing: "Não há pendências. Missão concluída! 🏆"
  }
];

const UPDATE_LINK_LABEL = "📲 Acompanhe a lista e veja quem já pagou:";
const COMPLETE_LINK_LABEL = "📲 Confira a lista e veja o resultado:";

const PERIOD_GREETINGS = {
  manha: "Bom dia, pessoal! ☀️",
  tarde: "Boa tarde, pessoal! 🌤️",
  noite: "Boa noite, pessoal! 🌙"
};

const PERIOD_INSTRUCTIONS = {
  manha: "Comece a mensagem com uma saudação de bom dia.",
  tarde: "Comece a mensagem com uma saudação de boa tarde.",
  noite: "Comece a mensagem com uma saudação de boa noite."
};

const TYPE_INSTRUCTIONS = {
  aviso: "O objetivo desta mensagem é um aviso/lembrete importante: destaque o prazo, as pendências e a necessidade de pagamento.",
  atualizacao: "O objetivo desta mensagem é informar a atualização atual dos pagamentos, como um status do andamento.",
  curta: "A mensagem deve ser bem curta e objetiva, com poucas linhas, mantendo apenas os valores essenciais, o PIX e o link."
};

function pickStyle(styles, variant) {
  if (typeof variant === "number" && Number.isFinite(variant)) {
    return styles[Math.abs(Math.trunc(variant)) % styles.length];
  }
  if (typeof variant === "string") {
    const found = styles.find((style) => style.key === variant);
    if (found) return found;
  }
  return styles[Math.floor(Math.random() * styles.length)];
}

function eventName(data) {
  return [data.title, data.subtitle].filter(Boolean).join(" — ") || "nossa contribuição";
}

export function isContributionComplete(data) {
  return Number(data.totalParticipants) > 0 && Number(data.pendingParticipants) === 0;
}

function buildUpdateDraft(data, style, greeting = style.greeting) {
  const label = data.installmentLabel || "1ª PARCELA";
  const event = eventName(data);
  const lines = [
    greeting,
    "",
    style.intro(event),
    "",
    `💰 Valor total: ${brl(data.totalGoalCents)}`,
    `👥 Participantes: ${data.totalParticipants} pessoas`,
    `💵 ${label} por pessoa: ${brl(data.installmentCents)}`,
    "",
    `✅ Valor recebido até o momento: ${brl(data.receivedCents)}`,
    `❗ Falta arrecadar: ${brl(data.pendingCents)}`,
    "",
    style.thanks,
    "",
    style.pending,
    "",
    `🤑 PIX — ${data.pixName || "-"}`,
    `🔑 ${data.pixKey || "-"}`,
    "",
    style.closing(data.subtitle || "tudo")
  ];
  if (data.link) lines.push("", UPDATE_LINK_LABEL, data.link);
  return lines.join("\n");
}

function buildCompleteDraft(data, style, greeting = style.greeting) {
  const event = eventName(data);
  const lines = [
    style.headline,
    "",
    greeting,
    "",
    `✅ Status: 100% concluído`,
    `👥 Participantes: ${data.totalParticipants} pessoas`,
    `💰 Total arrecadado: ${brl(data.receivedCents)}`,
    `🏆 Pendentes: 0`,
    "",
    style.intro(event),
    "",
    style.thanks,
    "",
    style.closing
  ];
  if (data.link) lines.push("", COMPLETE_LINK_LABEL, data.link);
  return lines.join("\n");
}

function buildShortDraft(data, style, greeting) {
  const event = eventName(data);
  if (isContributionComplete(data)) {
    const lines = [
      greeting,
      "",
      `✅ ${event} está 100% concluída!`,
      `💰 Total arrecadado: ${brl(data.receivedCents)}`,
      "🏆 Pendentes: 0",
      "",
      style.thanks
    ];
    if (data.link) lines.push("", COMPLETE_LINK_LABEL, data.link);
    return lines.join("\n");
  }

  const label = data.installmentLabel || "1ª PARCELA";
  const lines = [
    greeting,
    "",
    `❗ Falta arrecadar: ${brl(data.pendingCents)}`,
    `👥 Pendentes: ${data.pendingParticipants}`,
    `💵 ${label} por pessoa: ${brl(data.installmentCents)}`,
    "",
    `🤑 PIX — ${data.pixName || "-"}`,
    `🔑 ${data.pixKey || "-"}`
  ];
  if (data.link) lines.push("", UPDATE_LINK_LABEL, data.link);
  return lines.join("\n");
}

function buildDraftForStyle(data, style, options = {}) {
  const greeting = PERIOD_GREETINGS[options.period] || style.greeting;
  if (options.type === "curta") return buildShortDraft(data, style, greeting);
  if (isContributionComplete(data)) return buildCompleteDraft(data, style, greeting);
  return buildUpdateDraft(data, style, greeting);
}

export function buildDraft(data, variant, options = {}) {
  const complete = isContributionComplete(data);
  const style = pickStyle(complete ? COMPLETE_STYLES : UPDATE_STYLES, variant);
  return buildDraftForStyle(data, style, options);
}

function withLink(message, link, label) {
  if (!link || message.includes(link)) return message;
  return `${message}\n\n${label}\n${link}`;
}

function buildSystemPrompt(data, style, options = {}) {
  const complete = isContributionComplete(data);
  const lines = [
    "Você escreve mensagens de atualização de vaquinha/contribuição para grupos de WhatsApp, em português do Brasil.",
    "",
    `Estilo desejado: ${style.tone}.`,
    complete
      ? "A contribuição está 100% concluída: todas as pessoas já pagaram e não há pendentes. Escreva uma mensagem de finalização, com agradecimento."
      : "A contribuição ainda está em andamento e existem pessoas pendentes. Escreva uma mensagem de atualização e lembrete.",
    "",
    "Regras obrigatórias:",
    "- A mensagem é feita de várias linhas curtas, NUNCA um parágrafo corrido.",
    "- Cada informação numérica fica em sua própria linha, no formato \"EMOJI Rótulo: VALOR\".",
    "- Separe os blocos com uma linha em branco.",
    "- Preserve EXATAMENTE todos os números, valores, emojis, nomes e o link no final.",
    "- Não invente valores, pagamentos ou informações que não estejam no rascunho.",
    "- Se houver um contexto fornecido pelo usuário, incorpore-o de forma natural sem inventar informações além dele.",
    "- Não use markdown (sem *, # ou crases). Retorne apenas a mensagem final."
  ];
  if (PERIOD_INSTRUCTIONS[options.period]) {
    lines.push(`- ${PERIOD_INSTRUCTIONS[options.period]}`);
  }
  if (TYPE_INSTRUCTIONS[options.type]) {
    lines.push(`- ${TYPE_INSTRUCTIONS[options.type]}`);
  }
  return lines.join("\n");
}

function buildUserPrompt(data, draft, style, context, options = {}) {
  const complete = isContributionComplete(data);
  const lines = [
    `Reescreva a mensagem abaixo em uma versão ${style.tone}, pronta para enviar no grupo do WhatsApp.`,
    "Produza uma versão original e diferente de fórmulas prontas; não copie o rascunho literalmente.",
    "",
    "Regras:",
    "- NÃO junte tudo em um único parágrafo.",
    "- Preserve TODOS os números, valores, emojis, nomes e o link no final sem alteração."
  ];
  if (options.type === "curta") {
    lines.push(
      "- Produza uma mensagem curta e objetiva, mantendo apenas os dados essenciais, o PIX e o link.",
      "- Não acrescente blocos longos nem informações que não estejam no rascunho."
    );
  } else {
    lines.push("- Mantenha EXATAMENTE a mesma estrutura: cada informação em sua própria linha, com uma linha em branco entre os blocos.");
  }
  lines.push(
    complete
      ? "- A mensagem deve deixar claro que a contribuição foi 100% concluída e agradecer a todos."
      : "- A mensagem deve lembrar delicadamente quem ainda não pagou e manter o PIX.",
    "- Não use markdown."
  );
  if (context) {
    lines.push(
      "",
      "Contexto adicional fornecido pelo usuário (use como referência e incorpore de forma natural):",
      '"""',
      context,
      '"""'
    );
  }
  lines.push(
    "",
    "Mensagem:",
    '"""',
    draft,
    '"""',
    "",
    "Retorne apenas a mensagem final, pronta para enviar."
  );
  return lines.join("\n");
}

export const MESSAGE_PERIODS = ["auto", "manha", "tarde", "noite"];
export const MESSAGE_TYPES = ["padrao", "aviso", "atualizacao", "curta"];

function normalizeOption(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

export async function generateWhatsappMessage({ apiKey, baseUrl, model, data, variant, context, period, type }) {
  if (!apiKey) throw new Error("API key não configurada.");

  const cleanContext = String(context || "").trim().slice(0, 500);
  const selectedPeriod = normalizeOption(period, MESSAGE_PERIODS, "auto");
  const selectedType = normalizeOption(type, MESSAGE_TYPES, "padrao");
  const complete = isContributionComplete(data);
  const style = pickStyle(complete ? COMPLETE_STYLES : UPDATE_STYLES, variant);
  const draft = buildDraftForStyle(data, style, { period: selectedPeriod, type: selectedType });
  const linkLabel = complete ? COMPLETE_LINK_LABEL : UPDATE_LINK_LABEL;
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
          { role: "system", content: buildSystemPrompt(data, style, { period: selectedPeriod, type: selectedType }) },
          { role: "user", content: buildUserPrompt(data, draft, style, cleanContext, { period: selectedPeriod, type: selectedType }) }
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
  if (!raw) return withLink(draft, data.link, linkLabel);

  let message = String(raw).trim().replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
  const minLines = selectedType === "curta" ? 3 : 6;
  const enoughLines = message.split("\n").filter((line) => line.trim()).length >= minLines;
  if (!enoughLines) message = draft;
  return withLink(message, data.link, linkLabel);
}
