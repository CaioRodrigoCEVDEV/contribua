(function () {
  const slug = decodeURIComponent((location.pathname.split("/").filter(Boolean)[1] || ""));
  const tbody = document.getElementById("participants");
  const poster = document.querySelector(".poster");
  const printButton = document.getElementById("print-button");
  const heroBg = document.getElementById("hero-bg");

  let table = null;

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function render() {
    const { installment_cents: cents, summary, participants } = table;
    const totalCents = participants.length * cents;

    document.title = `${table.title} — pagamentos`;
    setText("poster-title", table.title);
    setText("poster-subtitle", table.subtitle);

    heroBg.style.backgroundImage = table.header_image ? `url("${table.header_image}")` : "";
    setText("installment-label-th", table.installment_label);
    setText("installment-due-th", table.installment_due);
    setText("installment-label-card", table.installment_label);
    setText("installment-due", table.installment_due);
    setText("installment-total", App.money(totalCents));
    setText("person-amount", App.money(cents));
    setText("paid-count", summary.paid);
    setText("pending-count", summary.pending);
    setText("total-count", summary.total);
    setText("received-total", App.money(summary.received_cents));
    setText("pending-total", App.money(summary.pending_cents));
    setText("pix-name", table.pix_name || "—");
    setText("pix-key", table.pix_key || "—");
    setText("installment-caption", totalCents > 0 ? `${Math.round((summary.received_cents / totalCents) * 100)}% do valor total pago` : "");

    tbody.innerHTML = "";
    participants.forEach((p, index) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td data-label="#">${index + 1}</td>
        <td class="participant-name" data-label="Participante"></td>
        <td data-label="${App.escape(table.installment_label || "Parcela")}">${App.money(cents)}</td>
        <td data-label="Status">
          <button type="button" class="status-toggle ${p.paid ? "paid" : "pending"}"
            aria-pressed="${p.paid}" ${table.allow_public_edit ? "" : "disabled"}>
            ${p.paid ? "Pago" : "Não pago"}
          </button>
        </td>`;
      tr.querySelector(".participant-name").textContent = p.name;
      tr.querySelector("button").addEventListener("click", () => toggle(p.id));
      tbody.appendChild(tr);
    });
  }

  async function toggle(participantId) {
    try {
      const { table: updated } = await App.api(`/api/public/${slug}/toggle`, {
        method: "POST",
        body: { participantId }
      });
      table = updated;
      render();
    } catch (error) {
      App.toast(error.message);
    }
  }

  function fitPoster() {
    const margin = 24;
    const scale = Math.min(
      (window.innerWidth - margin) / poster.offsetWidth,
      (window.innerHeight - margin) / poster.offsetHeight,
      1
    );
    document.documentElement.style.setProperty("--poster-scale", String(Math.max(scale, 0.3)));
  }
  window.addEventListener("resize", fitPoster);
  window.addEventListener("load", fitPoster);

  document.getElementById("copy-pix").addEventListener("click", async () => {
    const key = table?.pix_key || "";
    try {
      await navigator.clipboard.writeText(key);
      App.toast("Chave Pix copiada!");
    } catch {
      App.toast("Chave Pix: " + key);
    }
  });

  async function shareOrDownload(blob) {
    const fileName = `${slug}.png`;
    const file = new File([blob], fileName, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: table?.title || "Pagamentos" });
        return;
      } catch (error) {
        if (error && error.name === "AbortError") return;
      }
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    App.toast("Imagem salva! Compartilhe no WhatsApp.");
  }

  printButton.addEventListener("click", async () => {
    if (typeof html2canvas !== "function") return App.toast("Não foi possível gerar a imagem.");
    const previousTransform = poster.style.transform;
    const previousPosition = poster.style.position;
    printButton.disabled = true;
    try {
      poster.style.transform = "none";
      poster.style.position = "static";
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const canvas = await html2canvas(poster, {
        backgroundColor: null,
        scale: 2,
        useCORS: true,
        windowWidth: 1400,
        windowHeight: Math.max(poster.scrollHeight, 1200)
      });
      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      if (!blob) throw new Error("falha");
      await shareOrDownload(blob);
    } catch {
      App.toast("Não foi possível gerar a imagem.");
    } finally {
      poster.style.transform = previousTransform;
      poster.style.position = previousPosition;
      printButton.disabled = false;
    }
  });

  async function init() {
    try {
      const data = await App.api(`/api/public/${slug}`);
      table = data.table;
      render();
      fitPoster();
    } catch (error) {
      document.querySelector(".toolbar").hidden = true;
      poster.innerHTML = `<div style="padding:80px 40px;text-align:center;font-family:Inter,Arial,sans-serif">
        <h1 style="font-size:28px;color:#063b2c;margin-bottom:10px">Tabela não encontrada</h1>
        <p style="color:#5e6875">${App.escape(error.message)}</p>
      </div>`;
      poster.style.position = "static";
      poster.style.transform = "none";
      poster.style.width = "auto";
    }
  }

  init();
})();
