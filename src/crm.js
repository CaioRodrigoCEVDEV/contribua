import { randomUUID } from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";

export const CRM_MAX_MESSAGE_LENGTH = 4096;
export const CRM_DEFAULT_TIMEOUT_MS = 20_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CRM_PATH_RE = /\/api\/integrations\/webhooks\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/execute$/i;
const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

export class CrmValidationError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.name = "CrmValidationError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export class CrmSendError extends Error {
  constructor(code, message, httpStatus = 502, options = {}) {
    super(message);
    this.name = "CrmSendError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.keepIdempotencyKey = Boolean(options.keepIdempotencyKey);
    this.idempotencyKey = options.idempotencyKey || null;
    this.unknownResult = Boolean(options.unknownResult);
  }
}

export function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

function ipv4IsBlocked(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function ipv6IsBlocked(address) {
  const value = address.toLowerCase().split("%")[0];
  if (value.startsWith("::ffff:")) {
    const mapped = value.slice("::ffff:".length);
    if (mapped.includes(".")) return ipv4IsBlocked(mapped);
    const groups = mapped.split(":");
    if (groups.length === 2) {
      const high = Number.parseInt(groups[0], 16);
      const low = Number.parseInt(groups[1], 16);
      if (Number.isInteger(high) && Number.isInteger(low)) {
        return ipv4IsBlocked(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
      }
    }
  }
  if (value.includes(".")) {
    const lastColon = value.lastIndexOf(":");
    return ipv4IsBlocked(value.slice(lastColon + 1));
  }
  if (value === "::" || value === "::1") return true;
  if (value.startsWith("fc") || value.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(value)) return true;
  if (value.startsWith("ff")) return true;
  if (value.startsWith("2001:db8")) return true;
  return false;
}

export function isPrivateAddress(address) {
  const version = net.isIP(address);
  if (version === 4) return ipv4IsBlocked(address);
  if (version === 6) return ipv6IsBlocked(address);
  return true;
}

function parsePublicUrl(raw, { requireHttps, allowQuery = false, label = "do CRM", maxLength = 2_000 }) {
  const value = String(raw == null ? "" : raw).trim();
  if (!value || value.length > maxLength) {
    throw new CrmValidationError("CRM_URL_INVALID", `Informe uma URL válida ${label}.`);
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new CrmValidationError("CRM_URL_INVALID", `A URL ${label} é inválida.`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new CrmValidationError("CRM_URL_INVALID", `A URL ${label} deve usar HTTP ou HTTPS.`);
  }
  if (requireHttps && url.protocol !== "https:") {
    throw new CrmValidationError("CRM_URL_HTTPS_REQUIRED", `Em produção, a URL ${label} deve usar HTTPS.`);
  }
  if (url.username || url.password) {
    throw new CrmValidationError("CRM_URL_CREDENTIALS", `A URL ${label} não pode conter usuário ou senha.`);
  }
  if ((!allowQuery && url.search) || url.hash) {
    throw new CrmValidationError("CRM_URL_INVALID", `A URL ${label} não pode conter parâmetros ou fragmentos.`);
  }

  let hostname = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1);
  }
  if (!hostname) {
    throw new CrmValidationError("CRM_URL_INVALID", `A URL ${label} não possui um host válido.`);
  }
  if (
    hostname === "localhost" ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new CrmValidationError("CRM_URL_PRIVATE", `A URL ${label} não pode apontar para um host local.`);
  }
  if (net.isIP(hostname) && isPrivateAddress(hostname)) {
    throw new CrmValidationError(
      "CRM_URL_PRIVATE",
      `A URL ${label} não pode apontar para um endereço privado, reservado ou local.`
    );
  }

  return { url, hostname };
}

function basicValidateEndpoint(raw, { requireHttps }) {
  const { url, hostname } = parsePublicUrl(raw, { requireHttps, label: "do endpoint do CRM" });

  const pathname = url.pathname.replace(/\/+$/, "");
  if (/\/api\/api(\/|$)/i.test(pathname)) {
    throw new CrmValidationError(
      "CRM_URL_PATH_INVALID",
      "A URL do CRM deve conter o prefixo /api apenas uma vez."
    );
  }
  if (!CRM_PATH_RE.test(pathname)) {
    throw new CrmValidationError(
      "CRM_URL_PATH_INVALID",
      "A URL do CRM deve terminar em /api/integrations/webhooks/{id-da-integração}/execute."
    );
  }

  return { url, hostname };
}

async function assertPublicHostname(hostname, lookup, label) {
  if (net.isIP(hostname)) return;

  let addresses;
  try {
    addresses = await lookup(hostname);
  } catch {
    throw new CrmValidationError(
      "CRM_HOST_UNRESOLVABLE",
      `Não foi possível resolver o domínio da URL ${label}.`
    );
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new CrmValidationError(
      "CRM_HOST_UNRESOLVABLE",
      `Não foi possível resolver o domínio da URL ${label}.`
    );
  }
  if (addresses.some((entry) => isPrivateAddress(String(entry.address || entry)))) {
    throw new CrmValidationError(
      "CRM_URL_PRIVATE",
      `A URL ${label} não pode apontar para um endereço privado, reservado ou local.`
    );
  }
}

async function defaultLookup(hostname) {
  return dns.lookup(hostname, { all: true, verbatim: true });
}

export async function normalizeCrmEndpoint(raw, options = {}) {
  const requireHttps = options.requireHttps ?? process.env.NODE_ENV === "production";
  const lookup = options.lookup || defaultLookup;
  const { url, hostname } = basicValidateEndpoint(raw, { requireHttps });
  await assertPublicHostname(hostname, lookup, "do endpoint do CRM");
  return url.toString();
}

export async function normalizeImageUrl(raw, options = {}) {
  const requireHttps = options.requireHttps ?? process.env.NODE_ENV === "production";
  const lookup = options.lookup || defaultLookup;
  const { url, hostname } = parsePublicUrl(raw, {
    requireHttps,
    allowQuery: true,
    label: "da imagem",
    maxLength: 2_048
  });
  await assertPublicHostname(hostname, lookup, "da imagem");
  return url.toString();
}

export function normalizeIdempotencyKey(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return randomUUID();
  }
  const key = String(value).trim();
  if (!UUID_RE.test(key)) {
    throw new CrmSendError(
      "CRM_IDEMPOTENCY_KEY_INVALID",
      "A chave de idempotência deve ser um UUID válido.",
      400,
      { keepIdempotencyKey: false }
    );
  }
  return key;
}

function executionFrom(json) {
  return {
    execution_id: json.executionId ?? json.execution_id ?? null,
    status: json.status ?? null,
    external_message_id: json.externalMessageId ?? json.external_message_id ?? null,
    message_id: json.messageId ?? json.message_id ?? null,
    conversation_id: json.conversationId ?? json.conversation_id ?? null
  };
}

function upstreamCode(json) {
  return String(json?.code || json?.error?.code || "").trim();
}

function upstreamMessage(json) {
  return String(json?.message || json?.error?.message || "").trim();
}

function upstreamDetails(json) {
  return json?.details || json?.error?.details || {};
}

function mapUpstreamError(status, json, idempotencyKey) {
  const code = upstreamCode(json);
  const details = upstreamDetails(json);
  const executionId = details.executionId || details.execution_id || null;

  if (status === 401 || code === "WEBHOOK_UNAUTHORIZED") {
    return new CrmSendError(
      "CRM_UNAUTHORIZED",
      "O CRM recusou o segredo configurado. Atualize o segredo em Configurações.",
      502,
      { keepIdempotencyKey: false, idempotencyKey }
    );
  }
  if (status === 404 || code === "WEBHOOK_INTEGRATION_NOT_FOUND") {
    return new CrmSendError(
      "CRM_INTEGRATION_NOT_FOUND",
      "A integração informada não foi encontrada no CRM. Confira a URL configurada.",
      502,
      { keepIdempotencyKey: false, idempotencyKey }
    );
  }
  if (code === "WEBHOOK_INTEGRATION_INACTIVE") {
    return new CrmSendError(
      "CRM_INTEGRATION_INACTIVE",
      "A integração está inativa no CRM. Ative-a no CRM e tente novamente.",
      409,
      { keepIdempotencyKey: false, idempotencyKey }
    );
  }
  if (code === "WEBHOOK_INSTANCE_UNAVAILABLE") {
    return new CrmSendError(
      "CRM_INSTANCE_UNAVAILABLE",
      "A instância do WhatsApp está desconectada no CRM. Reconecte-a e tente novamente.",
      409,
      { keepIdempotencyKey: false, idempotencyKey }
    );
  }
  if (code === "WEBHOOK_EXECUTION_FAILED") {
    return new CrmSendError(
      "CRM_EXECUTION_FAILED",
      "A execução anterior desta operação falhou no CRM. Tente novamente para criar um novo envio.",
      502,
      { keepIdempotencyKey: false, idempotencyKey }
    );
  }
  if (status === 429 || code === "RATE_LIMITED") {
    return new CrmSendError(
      "CRM_RATE_LIMITED",
      "O limite de requisições do CRM foi excedido. Aguarde alguns instantes e tente novamente.",
      429,
      { keepIdempotencyKey: true, idempotencyKey }
    );
  }
  if (status === 502 || code === "WEBHOOK_PROVIDER_ERROR") {
    return new CrmSendError(
      "CRM_SEND_FAILED",
      "O CRM não conseguiu enviar a mensagem pelo WhatsApp. Tente novamente.",
      502,
      { keepIdempotencyKey: false, idempotencyKey }
    );
  }
  if (status === 503 || code === "WEBHOOK_PROVIDER_UNAVAILABLE") {
    return new CrmSendError(
      "CRM_UNAVAILABLE",
      "O serviço de WhatsApp do CRM está indisponível. Tente novamente em instantes.",
      503,
      { keepIdempotencyKey: true, idempotencyKey }
    );
  }
  if (status === 400 || code === "WEBHOOK_MESSAGE_REQUIRED") {
    return new CrmSendError(
      "CRM_MESSAGE_REJECTED",
      upstreamMessage(json) || "O CRM rejeitou a mensagem enviada.",
      400,
      { keepIdempotencyKey: false, idempotencyKey }
    );
  }

  const unknown = status >= 500;
  return new CrmSendError(
    "CRM_ERROR",
    unknown
      ? "O CRM retornou um erro inesperado. O resultado do envio é desconhecido."
      : upstreamMessage(json) || "O CRM recusou o envio da mensagem.",
    unknown ? 502 : 400,
    { keepIdempotencyKey: unknown, idempotencyKey, unknownResult: unknown }
  );
}

export async function sendCrmMessage({
  endpoint,
  secret,
  message,
  imageUrl,
  idempotencyKey,
  fetchImpl = fetch,
  lookup,
  timeoutMs = Number(process.env.CRM_TIMEOUT_MS) || CRM_DEFAULT_TIMEOUT_MS,
  requireHttps
}) {
  if (!secret) {
    throw new CrmSendError(
      "CRM_NOT_CONFIGURED",
      "O segredo da integração com o CRM não está configurado.",
      409,
      { keepIdempotencyKey: false }
    );
  }
  if (typeof message !== "string" || !message.trim()) {
    throw new CrmSendError(
      "CRM_MESSAGE_REQUIRED",
      "Informe a mensagem que será enviada ao CRM.",
      400,
      { keepIdempotencyKey: false }
    );
  }
  if (message.length > CRM_MAX_MESSAGE_LENGTH) {
    throw new CrmSendError(
      "CRM_MESSAGE_TOO_LONG",
      `A mensagem excede o limite de ${CRM_MAX_MESSAGE_LENGTH} caracteres do CRM.`,
      400,
      { keepIdempotencyKey: false }
    );
  }

  const key = normalizeIdempotencyKey(idempotencyKey);
  const normalizedEndpoint = await normalizeCrmEndpoint(endpoint, { lookup, requireHttps });
  const normalizedImageUrl = imageUrl
    ? await normalizeImageUrl(imageUrl, { lookup, requireHttps })
    : "";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetchImpl(normalizedEndpoint, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
        "Idempotency-Key": key
      },
      body: JSON.stringify(normalizedImageUrl ? { message, imageUrl: normalizedImageUrl } : { message })
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new CrmSendError(
        "CRM_TIMEOUT",
        "O CRM demorou demais para responder. O resultado do envio é desconhecido; tente novamente mantendo a mesma chave de idempotência.",
        504,
        { keepIdempotencyKey: true, idempotencyKey: key, unknownResult: true }
      );
    }
    throw new CrmSendError(
      "CRM_NETWORK_ERROR",
      "Não foi possível contatar o CRM. O resultado do envio é desconhecido; tente novamente mantendo a mesma chave de idempotência.",
      502,
      { keepIdempotencyKey: true, idempotencyKey: key, unknownResult: true }
    );
  } finally {
    clearTimeout(timer);
  }

  const bodyText = await response.text().catch(() => "");
  let json;
  try {
    json = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    json = null;
  }

  if (!json || typeof json !== "object") {
    const unknown = response.status >= 500;
    throw new CrmSendError(
      "CRM_INVALID_RESPONSE",
      unknown
        ? "O CRM retornou uma resposta inválida. O resultado do envio é desconhecido; tente novamente mantendo a mesma chave de idempotência."
        : "O CRM retornou uma resposta inválida.",
      502,
      { keepIdempotencyKey: unknown, idempotencyKey: key, unknownResult: unknown }
    );
  }

  const code = upstreamCode(json);
  if (
    response.status === 409 &&
    code === "WEBHOOK_EXECUTION_IN_PROGRESS"
  ) {
    const details = upstreamDetails(json);
    return {
      ok: true,
      status: "processing",
      idempotency_key: key,
      execution: {
        execution_id: details.executionId || details.execution_id || null,
        status: "PROCESSING",
        external_message_id: null,
        message_id: null,
        conversation_id: null
      }
    };
  }

  if (!response.ok) {
    throw mapUpstreamError(response.status, json, key);
  }
  if (json.ok !== true) {
    throw new CrmSendError(
      "CRM_INVALID_RESPONSE",
      "O CRM retornou uma resposta inesperada. O resultado do envio é desconhecido; tente novamente mantendo a mesma chave de idempotência.",
      502,
      { keepIdempotencyKey: true, idempotencyKey: key, unknownResult: true }
    );
  }

  const status = String(json.status || "").toUpperCase();
  return {
    ok: true,
    status: status === "PROCESSING" ? "processing" : "success",
    idempotency_key: key,
    execution: executionFrom(json)
  };
}
