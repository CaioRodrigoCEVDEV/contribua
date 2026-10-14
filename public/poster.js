(function () {
  const slug = decodeURIComponent((location.pathname.split("/").filter(Boolean)[1] || ""));
  const tbody = document.getElementById("participants");
  const poster = document.querySelector(".poster");
  const printButton = document.getElementById("print-button");
  const heroBg = document.getElementById("hero-bg");

  const placeSection = document.getElementById("place");
  const carousel = document.getElementById("carousel");
  const carouselTrack = document.getElementById("carousel-track");
  const carouselDots = document.getElementById("carousel-dots");
  const placeAddress = document.getElementById("place-address");
  const placeMap = document.getElementById("place-map");
  const lightbox = document.getElementById("lightbox");
  const lightboxImg = document.getElementById("lightbox-img");

  const PIN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s7-6.3 7-12a7 7 0 1 0-14 0c0 5.7 7 12 7 12z"></path><circle cx="12" cy="10" r="2.7"></circle></svg>';

  let table = null;
  let images = [];
  let slideIndex = 0;
  let slideTimer = null;
  let lightboxIndex = 0;

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

  function mapEmbedUrl(link) {
    if (!link) return "";
    const coord = link.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || link.match(/[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (coord) return `https://www.google.com/maps?q=${coord[1]},${coord[2]}&z=15&output=embed`;
    const query = link.match(/[?&]q=([^&]+)/);
    if (query) return `https://www.google.com/maps?q=${query[1]}&output=embed`;
    const place = link.match(/\/maps\/place\/([^/@?]+)/);
    if (place) return `https://www.google.com/maps?q=${place[1]}&output=embed`;
    return "";
  }

  function renderPlace() {
    images = Array.isArray(table.images) ? table.images : [];
    const address = table.location_address || "";
    const link = table.location_url || "";
    const embed = mapEmbedUrl(link);

    if (!images.length && !address && !link) {
      placeSection.hidden = true;
      document.body.classList.remove("has-place");
      return;
    }
    placeSection.hidden = false;
    document.body.classList.add("has-place");

    if (images.length) {
      renderCarousel();
      carousel.hidden = false;
    } else {
      carousel.hidden = true;
    }

    const href = link || embed;
    if (address || href) {
      placeAddress.hidden = false;
      placeAddress.innerHTML = `${PIN_SVG}<span></span>`;
      placeAddress.querySelector("span").textContent = address || "Ver no Google Maps";
      if (href) placeAddress.href = href;
      else placeAddress.removeAttribute("href");
    } else {
      placeAddress.hidden = true;
    }

    if (embed) {
      placeMap.hidden = false;
      placeMap.innerHTML = `<iframe src="${App.escape(embed)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Mapa do local" allowfullscreen></iframe>`;
    } else {
      placeMap.hidden = true;
    }
  }

  function renderCarousel() {
    carouselTrack.innerHTML = "";
    carouselDots.innerHTML = "";
    images.forEach((image, index) => {
      const slide = document.createElement("img");
      slide.className = `slide${index === 0 ? " active" : ""}`;
      slide.src = image.url;
      slide.alt = "";
      slide.loading = index === 0 ? "eager" : "lazy";
      slide.addEventListener("click", () => openLightbox(index));
      carouselTrack.appendChild(slide);

      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = index === 0 ? "active" : "";
      dot.setAttribute("aria-label", `Foto ${index + 1}`);
      dot.addEventListener("click", () => { goTo(index); startAuto(); });
      carouselDots.appendChild(dot);
    });
    slideIndex = 0;
    if (images.length > 1) startAuto();
  }

  function goTo(index) {
    if (!images.length) return;
    slideIndex = (index + images.length) % images.length;
    carouselTrack.querySelectorAll(".slide").forEach((el, i) => el.classList.toggle("active", i === slideIndex));
    carouselDots.querySelectorAll("button").forEach((el, i) => el.classList.toggle("active", i === slideIndex));
  }

  function startAuto() {
    stopAuto();
    if (images.length > 1) slideTimer = setInterval(() => goTo(slideIndex + 1), 5000);
  }
  function stopAuto() {
    if (slideTimer) clearInterval(slideTimer);
    slideTimer = null;
  }

  document.getElementById("carousel-prev").addEventListener("click", () => { goTo(slideIndex - 1); startAuto(); });
  document.getElementById("carousel-next").addEventListener("click", () => { goTo(slideIndex + 1); startAuto(); });
  carousel.addEventListener("mouseenter", stopAuto);
  carousel.addEventListener("mouseleave", startAuto);

  function openLightbox(index) {
    if (!images.length) return;
    lightboxIndex = index;
    updateLightbox();
    lightbox.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function updateLightbox() { lightboxImg.src = images[lightboxIndex].url; }
  function closeLightbox() {
    lightbox.hidden = true;
    document.body.style.overflow = "";
  }
  function lightboxNext() { lightboxIndex = (lightboxIndex + 1) % images.length; updateLightbox(); }
  function lightboxPrev() { lightboxIndex = (lightboxIndex - 1 + images.length) % images.length; updateLightbox(); }

  document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
  document.getElementById("lightbox-next").addEventListener("click", lightboxNext);
  document.getElementById("lightbox-prev").addEventListener("click", lightboxPrev);
  lightbox.addEventListener("click", (event) => { if (event.target === lightbox) closeLightbox(); });
  document.addEventListener("keydown", (event) => {
    if (lightbox.hidden) return;
    if (event.key === "Escape") closeLightbox();
    else if (event.key === "ArrowRight") lightboxNext();
    else if (event.key === "ArrowLeft") lightboxPrev();
  });

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
    const stage = document.querySelector(".poster-stage");
    if (window.innerWidth <= 820) {
      stage.style.height = "";
      return;
    }
    const margin = 24;
    const base = 1400;
    const scale = Math.min(
      (window.innerWidth - margin) / base,
      (window.innerHeight - margin) / poster.offsetHeight,
      1
    );
    document.documentElement.style.setProperty("--poster-scale", String(scale));
    stage.style.height = `${poster.offsetHeight * scale}px`;
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
      renderPlace();
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
