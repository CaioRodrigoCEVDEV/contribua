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

  let mode = "create";
  let current = null;
  let headerImage = "";

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
      card.innerHTML = `
        <div>
          <h3>${App.escape(table.title)}</h3>
          <div class="sub">${App.escape(table.subtitle || table.installment_label)}</div>
        </div>
        <div class="stats">
          <span class="pill">${table.paid_participants} pagos</span>
          <span class="pill red">${pending} pendentes</span>
          <span class="pill gray">${table.total_participants} no total</span>
        </div>
        <div class="share">
          <input type="text" readonly value="${App.escape(shareLink(table.slug))}">
          <button type="button" data-action="copy" data-slug="${App.escape(table.slug)}">Copiar</button>
        </div>
        <div class="actions">
          <button class="btn" type="button" data-action="open" data-slug="${App.escape(table.slug)}">Abrir link</button>
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
  });

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

  async function fileToDataUrl(file) {
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
    let maxDim = 900;
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
    row.dataset.id = p.id;
    row.innerHTML = `
      <span class="idx">${index + 1}</span>
      <input type="text" value="${App.escape(p.name)}" data-role="name">
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#5e6875">
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

  participantsList.addEventListener("focusout", async (event) => {
    if (event.target.dataset.role !== "name") return;
    const row = event.target.closest(".participant-row");
    const name = event.target.value.trim();
    if (!name) { App.toast("O nome não pode ficar vazio."); return; }
    try {
      await App.api(`/api/tables/${current.id}/participants/${row.dataset.id}`, { method: "PUT", body: { name } });
    } catch (error) { App.toast(error.message); }
  });

  participantsList.addEventListener("click", async (event) => {
    if (event.target.dataset.role !== "del") return;
    const row = event.target.closest(".participant-row");
    if (!confirm("Excluir este participante?")) return;
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
    if (!confirm(`Excluir a tabela "${current.title}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await App.api(`/api/tables/${current.id}`, { method: "DELETE" });
      App.toast("Tabela excluída.");
      closeEditor();
      loadTables();
    } catch (error) { App.toast(error.message); }
  });
})();
