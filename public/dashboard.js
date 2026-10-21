(function () {
  const cardsEl = document.getElementById("cards");
  const emptyEl = document.getElementById("empty");
  const editorEl = document.getElementById("editor");
  const form = document.getElementById("editor-form");
  const editorTitle = document.getElementById("editor-title");
  const editorSub = document.getElementById("editor-sub");
  const blockBulk = document.getElementById("block-bulk");
  const blockManage = document.getElementById("block-manage");
  const participantsList = document.getElementById("participants-list");
  const deleteBtn = document.getElementById("delete-table");
  const saveBtn = document.getElementById("save-table");
  const headerImageInput = form.elements.header_image_file;
  const headerPreview = document.getElementById("header-image-preview");
  const headerPreviewImg = document.getElementById("header-image-preview-img");
  const headerEmpty = document.getElementById("header-image-empty");
  const galleryInput = document.getElementById("gallery-input");
  const galleryList = document.getElementById("gallery-list");

  let mode = "create";
  let current = null;
  let headerImage = "";

  const themeToggle = document.getElementById("theme-toggle");

  function applyTheme(theme, persist) {
    document.documentElement.dataset.theme = theme;
    if (persist) {
      try { localStorage.setItem("contribua-theme", theme); } catch (error) { /* ignora */ }
    }
    themeToggle.setAttribute("aria-pressed", theme === "dark");
  }

  themeToggle.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next, true);
  });

  applyTheme(document.documentElement.dataset.theme || "light", false);

  const darkMedia = window.matchMedia("(prefers-color-scheme: dark)");
  if (darkMedia.addEventListener) {
    darkMedia.addEventListener("change", (event) => {
      let stored = null;
      try { stored = localStorage.getItem("contribua-theme"); } catch (error) { /* ignora */ }
      if (!stored) applyTheme(event.matches ? "dark" : "light", false);
    });
  }

  const settingsModal = document.getElementById("settings-modal");
  const settingsForm = document.getElementById("settings-form");
  const settingsKeyHint = document.getElementById("settings-key-hint");
  const settingsRemoveKey = document.getElementById("settings-remove-key");
  const settingsCrmStatus = document.getElementById("settings-crm-status");
  const settingsCrmSecretHint = document.getElementById("settings-crm-secret-hint");

  function crmSettingsStatus(crm) {
    if (!crm || !crm.enabled) return "Integração desativada.";
    if (crm.status === "ready") return "Integração ativa e configurada.";
    return "Integração ativa, mas incompleta. Informe a URL e o segredo.";
  }

  async function openSettings() {
    try {
      const { settings } = await App.api("/api/settings");
      settingsForm.elements.model.value = settings.model || "";
      settingsForm.elements.base_url.value = settings.base_url || "";
      settingsForm.elements.api_key.value = "";
      settingsForm.elements.api_key.placeholder = settings.has_key ? settings.masked_key : "sk-...";
      settingsKeyHint.textContent = settings.has_key
        ? "Chave configurada. Deixe em branco para manter."
        : "Nenhuma chave configurada.";
      settingsRemoveKey.hidden = !settings.has_key;

      const crm = settings.crm || {};
      settingsForm.elements.crm_enabled.checked = Boolean(crm.enabled);
      settingsForm.elements.crm_send_image.checked = crm.send_image !== false;
      settingsForm.elements.crm_endpoint_url.value = crm.endpoint_url || "";
      settingsForm.elements.crm_secret.value = "";
      settingsForm.elements.crm_secret.placeholder = crm.has_secret ? crm.masked_secret : "whk_...";
      settingsCrmSecretHint.textContent = crm.has_secret
        ? "Segredo configurado. Deixe em branco para manter."
        : "Nenhum segredo configurado.";
      settingsCrmStatus.textContent = crmSettingsStatus(crm);
      settingsCrmStatus.classList.toggle("is-ready", crm.status === "ready");
      settingsModal.hidden = false;
    } catch (error) {
      App.toast(error.message);
    }
  }

  function closeSettings() { settingsModal.hidden = true; }

  document.getElementById("settings-button").addEventListener("click", openSettings);
  document.getElementById("settings-cancel").addEventListener("click", closeSettings);
  settingsModal.addEventListener("click", (event) => { if (event.target === settingsModal) closeSettings(); });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !settingsModal.hidden) closeSettings();
  });

  settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = {
      model: settingsForm.elements.model.value.trim(),
      base_url: settingsForm.elements.base_url.value.trim(),
      crm_enabled: settingsForm.elements.crm_enabled.checked,
      crm_send_image: settingsForm.elements.crm_send_image.checked,
      crm_endpoint_url: settingsForm.elements.crm_endpoint_url.value.trim()
    };
    const apiKey = settingsForm.elements.api_key.value.trim();
    if (apiKey) body.api_key = apiKey;
    const crmSecret = settingsForm.elements.crm_secret.value.trim();
    if (crmSecret) body.crm_secret = crmSecret;
    try {
      await App.api("/api/settings", { method: "PUT", body });
      App.toast("Configurações salvas!");
      closeSettings();
    } catch (error) {
      App.toast(error.message);
    }
  });

  settingsRemoveKey.addEventListener("click", async () => {
    const ok = await App.confirm("A chave de IA será removida da sua conta.", {
      title: "Remover chave?",
      confirmLabel: "Remover",
      danger: true
    });
    if (!ok) return;
    try {
      await App.api("/api/settings", { method: "PUT", body: { api_key: "" } });
      App.toast("Chave removida.");
      closeSettings();
    } catch (error) {
      App.toast(error.message);
    }
  });

  App.currentUser().then((user) => {
    if (!user) {
      window.location.replace("/");
      return;
    }
    document.getElementById("who").textContent = user.name;
    loadTables();
  });

  document.getElementById("logout").addEventListener("click", async () => {
    await App.api("/api/auth/logout", { method: "POST" });
    window.location.replace("/");
  });

  async function loadTables() {
    try {
      const { tables } = await App.api("/api/tables");
      renderCards(tables);
    } catch (error) {
      App.toast(error.message);
    }
  }

  function shareLink(slug) {
    return `${window.location.origin}/t/${slug}`;
  }

  function renderCards(tables) {
    cardsEl.innerHTML = "";
    emptyEl.hidden = tables.length > 0;
    for (const table of tables) {
      const pending = table.total_participants - table.paid_participants;
      const card = document.createElement("article");
      card.className = "table-card";
      const banner = table.header_image
        ? `<img class="card-banner" src="${table.header_image}" alt="" loading="lazy">`
        : "";
      const due = table.installment_due
        ? `<div class="card-due"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="3"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg><span>Vence ${App.escape(table.installment_due)}</span></div>`
        : "";
      card.innerHTML = `
        ${banner}
        <div>
          <h3>${App.escape(table.title)}</h3>
          <div class="sub">${App.escape(table.subtitle || table.installment_label)}</div>
          ${due}
        </div>
        <div class="stats">
          <span class="pill">${table.paid_participants} pagos</span>
          <span class="pill red">${pending} pendentes</span>
          <span class="pill gray">${table.total_participants} no total</span>
          <span class="pill gray with-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>${table.visits} ${table.visits === 1 ? "visita" : "visitas"}</span>
        </div>
        <div class="share">
          <input type="text" readonly value="${App.escape(shareLink(table.slug))}">
          <button type="button" data-action="copy" data-slug="${App.escape(table.slug)}">Copiar</button>
        </div>
        <div class="actions">
          <button class="btn" type="button" data-action="open" data-slug="${App.escape(table.slug)}">Abrir link</button>
          <button class="btn" type="button" data-action="message" data-id="${table.id}">Mensagem</button>
          <button class="btn" type="button" data-action="duplicate" data-id="${table.id}" data-title="${App.escape(table.title)}">Duplicar</button>
          <button class="btn btn-dark" type="button" data-action="edit" data-id="${table.id}">Gerenciar</button>
        </div>`;
      cardsEl.appendChild(card);
    }
  }

  cardsEl.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "open") window.open(shareLink(button.dataset.slug), "_blank");
    if (action === "copy") {
      await navigator.clipboard.writeText(shareLink(button.dataset.slug)).catch(() => {});
      App.toast("Link copiado!");
    }
    if (action === "edit") openEdit(button.dataset.id);
    if (action === "duplicate") duplicateTable(button.dataset.id, button.dataset.title);
    if (action === "message") openMessageModal(button.dataset.id);
  });

  function buildModal(html) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal modal-wide" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  const MESSAGE_PERIODS = [
    { key: "auto", label: "Automático" },
    { key: "manha", label: "Manhã" },
    { key: "tarde", label: "Tarde" },
    { key: "noite", label: "Noite" }
  ];

  const MESSAGE_TYPES = [
    { key: "padrao", label: "Padrão" },
    { key: "aviso", label: "Aviso" },
    { key: "atualizacao", label: "Atualização" },
    { key: "curta", label: "Curta" }
  ];

  function presetChips(group, options, selected) {
    return options.map((option) => `
      <button class="preset-chip${option.key === selected ? " is-active" : ""}" type="button"
        data-preset="${group}" data-value="${option.key}" aria-pressed="${option.key === selected}">
        ${option.label}
      </button>`).join("");
  }

  function openMessageModal(id) {
    const state = { period: "auto", type: "padrao", variant: Math.floor(Math.random() * 5) };
    const overlay = buildModal(`
      <h3 class="modal-title">Mensagem para o WhatsApp</h3>
      <p class="modal-message">Escolha uma sugestão, ajuste o contexto se quiser e clique em gerar.</p>
      <div class="message-presets">
        <div class="preset-group">
          <span class="preset-label">Período</span>
          <div class="preset-chips" role="group" aria-label="Período da mensagem">
            ${presetChips("period", MESSAGE_PERIODS, state.period)}
          </div>
        </div>
        <div class="preset-group">
          <span class="preset-label">Tipo</span>
          <div class="preset-chips" role="group" aria-label="Tipo da mensagem">
            ${presetChips("type", MESSAGE_TYPES, state.type)}
          </div>
        </div>
      </div>
      <label class="field message-context">
        <span>Contexto para a IA (opcional)</span>
        <textarea class="modal-context" id="message-context" maxlength="500" rows="2" placeholder="Ex.: lembrar que o prazo é sexta-feira e agradecer a quem já pagou."></textarea>
        <small>Use este campo para dar uma referência e gerar uma versão personalizada.</small>
      </label>
      <p class="message-status" data-role="message-status" role="status" aria-live="polite" hidden></p>
      <div class="modal-actions">
        <button class="btn" type="button" data-role="close">Fechar</button>
        <button class="btn btn-primary" type="button" data-role="generate">Gerar mensagem</button>
      </div>`);
    const modal = overlay.querySelector(".modal");
    modal.querySelectorAll("[data-preset]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const group = chip.dataset.preset;
        state[group] = chip.dataset.value;
        modal.querySelectorAll(`[data-preset="${group}"]`).forEach((item) => {
          const active = item === chip;
          item.classList.toggle("is-active", active);
          item.setAttribute("aria-pressed", String(active));
        });
      });
    });
    modal.querySelector('[data-role="close"]').addEventListener("click", () => overlay.remove());
    const generateButton = modal.querySelector('[data-role="generate"]');
    generateButton.addEventListener("click", async () => {
      const status = modal.querySelector('[data-role="message-status"]');
      status.hidden = true;
      status.classList.remove("is-error");
      generateButton.disabled = true;
      generateButton.textContent = "Gerando...";
      try {
        const [messageResponse, settingsResponse] = await Promise.all([
          App.api(`/api/tables/${id}/message`, {
            method: "POST",
            body: {
              origin: window.location.origin,
              variant: state.variant,
              context: modal.querySelector("#message-context").value.trim(),
              period: state.period,
              type: state.type
            }
          }),
          App.api("/api/settings").catch(() => null)
        ]);
        renderMessageResult(overlay, id, messageResponse, settingsResponse, state);
      } catch (error) {
        status.hidden = false;
        status.classList.add("is-error");
        status.textContent = error.message;
        generateButton.disabled = false;
        generateButton.textContent = "Gerar mensagem";
      }
    });
  }

  function renderMessageResult(overlay, id, messageResponse, settingsResponse, state) {
    const message = messageResponse.message;
    let variant = state.variant;
    const imageUrl = messageResponse.image_url || "";
    const crm = settingsResponse && settingsResponse.settings && settingsResponse.settings.crm;
    const crmConfigured = Boolean(crm && crm.configured);
    const crmSendImage = crm ? crm.send_image !== false : true;
    const modal = overlay.querySelector(".modal");
    const modalTitle = messageResponse.complete
      ? "Mensagem de contribuição concluída"
      : "Mensagem para o WhatsApp";
    modal.innerHTML = `
      <h3 class="modal-title">${modalTitle}</h3>
      <label class="field message-context">
        <span>Contexto para a IA (opcional)</span>
        <textarea class="modal-context" id="message-context" maxlength="500" rows="2" placeholder="Ex.: lembrar que o prazo é sexta-feira e agradecer a quem já pagou."></textarea>
        <small>Use este campo para dar uma referência e gerar uma nova versão da mensagem.</small>
      </label>
      <textarea class="modal-textarea" id="generated-message"></textarea>
      <p class="crm-status" data-role="crm-status" role="status" aria-live="polite" hidden></p>
      <div class="modal-actions modal-actions-wrap">
        <button class="btn" type="button" data-role="regenerate">Gerar outra versão</button>
        <button class="btn" type="button" data-role="close">Fechar</button>
        <button class="btn" type="button" data-role="copy">Copiar</button>
        <button class="btn btn-dark" type="button" data-role="crm" ${crmConfigured ? "" : "disabled"}>Enviar ao CRM</button>
        <button class="btn btn-primary" type="button" data-role="whatsapp">Abrir no WhatsApp</button>
      </div>`;
    const textarea = modal.querySelector("#generated-message");
    const contextInput = modal.querySelector("#message-context");
    textarea.value = message;
    let lastGenerated = message;
    let regenerating = false;
    const regenerateButton = modal.querySelector('[data-role="regenerate"]');
    regenerateButton.addEventListener("click", async () => {
      if (regenerating) return;
      if (textarea.value !== lastGenerated) {
        const ok = await App.confirm("O texto editado será substituído pela nova versão.", {
          title: "Gerar nova versão?",
          confirmLabel: "Gerar"
        });
        if (!ok) return;
      }
      regenerating = true;
      regenerateButton.disabled = true;
      regenerateButton.textContent = "Gerando...";
      variant += 1;
      try {
        const response = await App.api(`/api/tables/${id}/message`, {
          method: "POST",
          body: {
            origin: window.location.origin,
            variant,
            context: contextInput.value.trim(),
            period: state.period,
            type: state.type
          }
        });
        textarea.value = response.message;
        lastGenerated = response.message;
        modal.querySelector(".modal-title").textContent = response.complete
          ? "Mensagem de contribuição concluída"
          : "Mensagem para o WhatsApp";
        App.toast("Nova versão gerada!");
      } catch (error) {
        App.toast(error.message);
      } finally {
        regenerating = false;
        regenerateButton.disabled = false;
        regenerateButton.textContent = "Gerar outra versão";
      }
    });
    modal.querySelector('[data-role="close"]').addEventListener("click", () => overlay.remove());
    modal.querySelector('[data-role="copy"]').addEventListener("click", async () => {
      await navigator.clipboard.writeText(textarea.value).catch(() => {});
      App.toast("Mensagem copiada!");
    });
    modal.querySelector('[data-role="whatsapp"]').addEventListener("click", async () => {
      const text = textarea.value;
      const isMobile = /android|iphone|ipad|ipod/i.test(navigator.userAgent);
      if (isMobile && navigator.share) {
        try {
          await navigator.share({ text });
          return;
        } catch (error) {
          if (error && error.name === "AbortError") return;
        }
      }
      const base = isMobile ? "https://wa.me/" : "https://web.whatsapp.com/send";
      window.open(`${base}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    });

    const crmButton = modal.querySelector('[data-role="crm"]');
    const crmStatus = modal.querySelector('[data-role="crm-status"]');
    if (crmConfigured && window.ContribuaCrm) {
      window.ContribuaCrm.createSender({
        api: App.api,
        button: crmButton,
        status: crmStatus,
        getMessage: () => textarea.value,
        getImageUrl: () => (crmSendImage ? imageUrl : "")
      });
    } else {
      crmButton.disabled = true;
      crmStatus.hidden = false;
      crmStatus.classList.add("is-info");
      crmStatus.textContent = "Integração com o CRM não configurada. Acesse Configurações → Integração com CRM.";
    }
  }

  async function duplicateTable(id, title) {
    const ok = await App.confirm("Os participantes serão copiados, mas o status de pagamento será reiniciado.", {
      title: `Duplicar "${title}"?`,
      confirmLabel: "Duplicar"
    });
    if (!ok) return;
    try {
      await App.api(`/api/tables/${id}/duplicate`, { method: "POST" });
      App.toast("Tabela duplicada!");
      loadTables();
    } catch (error) {
      App.toast(error.message);
    }
  }

  document.getElementById("new-table").addEventListener("click", openCreate);
  document.getElementById("new-table-2").addEventListener("click", openCreate);
  document.getElementById("cancel").addEventListener("click", closeEditor);
  editorEl.addEventListener("click", (event) => { if (event.target === editorEl) closeEditor(); });

  function openEditor() { editorEl.classList.add("open"); document.body.style.overflow = "hidden"; }
  function closeEditor() { editorEl.classList.remove("open"); document.body.style.overflow = ""; }

  function fillForm(table) {
    const f = form.elements;
    f.title.value = table?.title || "";
    f.subtitle.value = table?.subtitle || "";
    f.installment_label.value = table?.installment_label || "1ª PARCELA";
    f.installment_due.value = table?.installment_due || "";
    f.installment_reais.value = table ? (table.installment_cents / 100).toFixed(2) : "50.00";
    f.goal_reais.value = table && table.total_goal_cents ? (table.total_goal_cents / 100).toFixed(2) : "";
    f.pix_name.value = table?.pix_name || "";
    f.pix_key.value = table?.pix_key || "";
    f.allow_public_edit.checked = table ? table.allow_public_edit : true;
    f.location_address.value = table?.location_address || "";
    f.location_url.value = table?.location_url || "";
    f.participants_bulk.value = "";
    headerImage = table?.header_image || "";
    headerImageInput.value = "";
    renderHeaderPreview();
  }

  function renderHeaderPreview() {
    const has = Boolean(headerImage);
    headerPreview.hidden = !has;
    headerEmpty.hidden = has;
    if (has) headerPreviewImg.src = headerImage;
    else headerPreviewImg.removeAttribute("src");
  }

  async function fileToDataUrl(file, startDim = 900) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Arquivo de imagem inválido."));
      image.src = dataUrl;
    });
    const keepAlpha = /png|webp/i.test(file.type);
    const mime = keepAlpha ? "image/png" : "image/jpeg";
    let maxDim = startDim;
    let result = "";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!keepAlpha) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height); }
      ctx.drawImage(img, 0, 0, width, height);
      result = canvas.toDataURL(mime, 0.85);
      if (result.length <= 2_000_000) return result;
      maxDim = Math.round(maxDim * 0.75);
    }
    return result;
  }

  headerImageInput.addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      App.toast("Selecione um arquivo de imagem.");
      event.target.value = "";
      return;
    }
    try {
      headerImage = await fileToDataUrl(file);
      renderHeaderPreview();
    } catch (error) {
      App.toast(error.message);
    } finally {
      event.target.value = "";
    }
  });

  document.getElementById("remove-header-image").addEventListener("click", () => {
    headerImage = "";
    renderHeaderPreview();
  });

  function galleryThumb(image) {
    const item = document.createElement("div");
    item.className = "gallery-item";
    item.dataset.id = image.id;
    item.innerHTML = `
      <img src="${image.url}" alt="" loading="lazy">
      <button class="del" type="button" data-role="del" title="Remover">×</button>`;
    return item;
  }

  function renderGallery(images) {
    galleryList.innerHTML = "";
    (images || []).forEach((image) => galleryList.appendChild(galleryThumb(image)));
  }

  galleryInput.addEventListener("change", async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    if (galleryList.children.length + files.length > 12) {
      App.toast("Limite de 12 fotos.");
      return;
    }
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      try {
        const dataUrl = await fileToDataUrl(file, 1600);
        const { image } = await App.api(`/api/tables/${current.id}/images`, { method: "POST", body: { image: dataUrl } });
        galleryList.appendChild(galleryThumb(image));
      } catch (error) {
        App.toast(error.message);
      }
    }
  });

  galleryList.addEventListener("click", async (event) => {
    if (event.target.dataset.role !== "del") return;
    const item = event.target.closest(".gallery-item");
    try {
      await App.api(`/api/tables/${current.id}/images/${item.dataset.id}`, { method: "DELETE" });
      item.remove();
    } catch (error) {
      App.toast(error.message);
    }
  });

  function openCreate() {
    mode = "create";
    current = null;
    editorTitle.textContent = "Nova tabela";
    editorSub.textContent = "Defina os dados e adicione os participantes, um por linha.";
    blockBulk.hidden = false;
    blockManage.hidden = true;
    deleteBtn.hidden = true;
    fillForm(null);
    openEditor();
  }

  async function openEdit(id) {
    try {
      const { table } = await App.api(`/api/tables/${id}`);
      mode = "edit";
      current = table;
      editorTitle.textContent = "Gerenciar tabela";
      editorSub.textContent = "Edite os dados e os participantes. As mudanças nos participantes são salvas na hora.";
      blockBulk.hidden = true;
      blockManage.hidden = false;
      deleteBtn.hidden = false;
      fillForm(table);
      renderParticipants(table.participants);
      renderGallery(table.images);
      openEditor();
    } catch (error) {
      App.toast(error.message);
    }
  }

  function renderParticipants(participants) {
    participantsList.innerHTML = "";
    participants.forEach((p, index) => participantsList.appendChild(participantRow(p, index)));
  }

  function participantRow(p, index) {
    const row = document.createElement("div");
    row.className = "participant-row";
    if (p.note && p.note.trim()) row.classList.add("has-note");
    row.dataset.id = p.id;
    row.dataset.note = p.note || "";
    row.innerHTML = `
      <span class="idx">${index + 1}</span>
      <input type="text" value="${App.escape(p.name)}" data-role="name">
      <input type="text" value="${App.escape(p.note || "")}" data-role="note" class="note-input"
        placeholder="Observação" maxlength="120" aria-label="Observação do participante">
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted)">
        <input type="checkbox" data-role="paid" ${p.paid ? "checked" : ""} style="width:auto"> Pago
      </label>
      <button class="del" type="button" data-role="del" title="Excluir">×</button>`;
    return row;
  }

  participantsList.addEventListener("change", async (event) => {
    const row = event.target.closest(".participant-row");
    if (!row) return;
    const pid = row.dataset.id;
    try {
      if (event.target.dataset.role === "paid") {
        await App.api(`/api/tables/${current.id}/participants/${pid}`, { method: "PUT", body: { paid: event.target.checked } });
        App.toast("Status atualizado");
      }
    } catch (error) { App.toast(error.message); }
  });

  participantsList.addEventListener("input", (event) => {
    if (event.target.dataset.role !== "note") return;
    const row = event.target.closest(".participant-row");
    row.classList.toggle("has-note", Boolean(event.target.value.trim()));
  });

  participantsList.addEventListener("focusout", async (event) => {
    const role = event.target.dataset.role;
    if (role !== "name" && role !== "note") return;
    const row = event.target.closest(".participant-row");
    if (role === "name") {
      const name = event.target.value.trim();
      if (!name) { App.toast("O nome não pode ficar vazio."); return; }
      try {
        await App.api(`/api/tables/${current.id}/participants/${row.dataset.id}`, { method: "PUT", body: { name } });
      } catch (error) { App.toast(error.message); }
      return;
    }
    const note = event.target.value.trim().slice(0, 120);
    if (note === row.dataset.note) return;
    try {
      await App.api(`/api/tables/${current.id}/participants/${row.dataset.id}`, { method: "PUT", body: { note } });
      row.dataset.note = note;
      row.classList.toggle("has-note", Boolean(note));
      App.toast("Observação salva");
    } catch (error) {
      row.classList.toggle("has-note", Boolean(row.dataset.note));
      App.toast(error.message);
    }
  });

  participantsList.addEventListener("click", async (event) => {
    if (event.target.dataset.role !== "del") return;
    const row = event.target.closest(".participant-row");
    const ok = await App.confirm("O participante será removido desta tabela.", {
      title: "Excluir participante?",
      confirmLabel: "Excluir",
      danger: true
    });
    if (!ok) return;
    try {
      await App.api(`/api/tables/${current.id}/participants/${row.dataset.id}`, { method: "DELETE" });
      row.remove();
      renumber();
    } catch (error) { App.toast(error.message); }
  });

  function renumber() {
    participantsList.querySelectorAll(".participant-row .idx").forEach((el, i) => { el.textContent = i + 1; });
  }

  document.getElementById("add-participant").addEventListener("click", addParticipant);
  document.getElementById("new-participant").addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); addParticipant(); }
  });

  async function addParticipant() {
    const input = document.getElementById("new-participant");
    const name = input.value.trim();
    if (!name) return;
    try {
      const { participant } = await App.api(`/api/tables/${current.id}/participants`, { method: "POST", body: { name } });
      participantsList.appendChild(participantRow(participant, participantsList.children.length));
      input.value = "";
      input.focus();
    } catch (error) { App.toast(error.message); }
  }

  function collectFields() {
    const f = form.elements;
    const reais = (value, fallback) => {
      const n = Math.round(parseFloat(String(value).replace(",", ".")) * 100);
      return Number.isFinite(n) && n >= 0 ? n : fallback;
    };
    return {
      title: f.title.value.trim(),
      subtitle: f.subtitle.value.trim(),
      installment_label: f.installment_label.value.trim() || "1ª PARCELA",
      installment_due: f.installment_due.value.trim(),
      installment_cents: reais(f.installment_reais.value, 5000),
      total_goal_cents: reais(f.goal_reais.value, 0),
      pix_name: f.pix_name.value.trim(),
      pix_key: f.pix_key.value.trim(),
      header_image: headerImage,
      location_address: f.location_address.value.trim(),
      location_url: f.location_url.value.trim(),
      allow_public_edit: f.allow_public_edit.checked,
      participants_bulk: f.participants_bulk.value
    };
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fields = collectFields();
    if (!fields.title) { App.toast("Informe o título."); return; }
    saveBtn.disabled = true;
    try {
      if (mode === "create") {
        const participants = fields.participants_bulk.split("\n").map((n) => n.trim()).filter(Boolean);
        delete fields.participants_bulk;
        await App.api("/api/tables", { method: "POST", body: { ...fields, participants } });
        App.toast("Tabela criada!");
        closeEditor();
        loadTables();
      } else {
        delete fields.participants_bulk;
        await App.api(`/api/tables/${current.id}`, { method: "PUT", body: fields });
        App.toast("Tabela atualizada!");
        closeEditor();
        loadTables();
      }
    } catch (error) {
      App.toast(error.message);
    } finally {
      saveBtn.disabled = false;
    }
  });

  deleteBtn.addEventListener("click", async () => {
    const ok = await App.confirm(`A tabela "${current.title}" e todos os participantes serão removidos. Esta ação não pode ser desfeita.`, {
      title: "Excluir tabela?",
      confirmLabel: "Excluir",
      danger: true
    });
    if (!ok) return;
    try {
      await App.api(`/api/tables/${current.id}`, { method: "DELETE" });
      App.toast("Tabela excluída.");
      closeEditor();
      loadTables();
    } catch (error) { App.toast(error.message); }
  });
})();
