(function (root) {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const BUTTON_LABEL = "Enviar ao CRM";
  const MAX_MESSAGE_LENGTH = 4096;

  function newIdempotencyKey() {
    if (root.crypto && typeof root.crypto.randomUUID === "function") {
      return root.crypto.randomUUID();
    }
    if (root.crypto && typeof root.crypto.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      root.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20)
      ].join("-");
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
      const random = (Math.random() * 16) | 0;
      const value = char === "x" ? random : (random & 0x3) | 0x8;
      return value.toString(16);
    });
  }

  function createSender({ api, button, status, getMessage, getImageUrl, onChange }) {
    let sending = false;
    let pendingKey = null;
    let pendingMessage = null;

    function setStatus(text, kind) {
      if (!status) return;
      status.textContent = text || "";
      status.hidden = !text;
      status.classList.toggle("is-error", kind === "error");
      status.classList.toggle("is-success", kind === "success");
      status.classList.toggle("is-info", kind === "info");
    }

    function setSending(value) {
      sending = value;
      button.disabled = value;
      button.textContent = value ? "Enviando..." : BUTTON_LABEL;
      button.setAttribute("aria-busy", value ? "true" : "false");
    }

    async function send() {
      if (sending) return;
      const message = String(getMessage() == null ? "" : getMessage());
      if (!message.trim()) {
        setStatus("A mensagem está vazia.", "error");
        return;
      }
      if (message.length > MAX_MESSAGE_LENGTH) {
        setStatus(`A mensagem excede o limite de ${MAX_MESSAGE_LENGTH} caracteres.`, "error");
        return;
      }

      if (pendingKey && message !== pendingMessage) {
        pendingKey = null;
        pendingMessage = null;
      }
      if (!pendingKey) {
        pendingKey = newIdempotencyKey();
        pendingMessage = message;
      }

      const imageUrl = getImageUrl ? String(getImageUrl() || "").trim() : "";
      setSending(true);
      setStatus("Enviando ao CRM...", "info");

      try {
        const result = await api("/api/integrations/crm/send", {
          method: "POST",
          body: {
            message,
            idempotency_key: pendingKey,
            ...(imageUrl ? { image_url: imageUrl } : {})
          }
        });

        if (result && result.status === "processing") {
          setStatus(
            "O CRM ainda está processando este envio. Aguarde alguns instantes e tente novamente; a mesma chave de idempotência será mantida.",
            "info"
          );
          if (onChange) onChange(result);
          return;
        }

        pendingKey = null;
        pendingMessage = null;
        setStatus("Mensagem enviada ao CRM com sucesso.", "success");
        if (onChange) onChange(result);
      } catch (error) {
        const keepKey =
          Boolean(error && error.keep_idempotency_key === true) ||
          Boolean(
            error &&
            error.keep_idempotency_key !== false &&
            (error.status === undefined || error.status >= 500)
          );
        if (keepKey && error && error.idempotency_key) {
          pendingKey = error.idempotency_key;
          pendingMessage = message;
        }
        if (!keepKey) {
          pendingKey = null;
          pendingMessage = null;
        }
        const text = !error || error.status === undefined
          ? "Não foi possível contatar o servidor do Contribua. O resultado do envio é desconhecido; tente novamente mantendo a mesma chave."
          : error.message || "Não foi possível enviar a mensagem ao CRM.";
        setStatus(text, "error");
        if (onChange) onChange(null, error);
      } finally {
        setSending(false);
      }
    }

    button.addEventListener("click", send);

    return {
      send,
      get pendingKey() {
        return pendingKey;
      },
      get sending() {
        return sending;
      }
    };
  }

  root.ContribuaCrm = { createSender, newIdempotencyKey, UUID_RE };
})(typeof globalThis !== "undefined" ? globalThis : this);
