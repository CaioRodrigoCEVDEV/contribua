window.App = {
  async api(path, options = {}) {
    const { method = "GET", body } = options;
    const res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Erro na requisição");
    return data;
  },

  money(cents) {
    return (Number(cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  },

  escape(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  },

  confirm(message, options = {}) {
    const {
      title = "Confirmar",
      confirmLabel = "Confirmar",
      cancelLabel = "Cancelar",
      danger = false
    } = options;

    return new Promise((resolve) => {
      const previouslyFocused = document.activeElement;
      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";
      overlay.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-message">
          <h3 class="modal-title" id="modal-title"></h3>
          <p class="modal-message" id="modal-message"></p>
          <div class="modal-actions">
            <button type="button" class="btn" data-role="cancel"></button>
            <button type="button" class="btn ${danger ? "btn-danger-solid" : "btn-primary"}" data-role="confirm"></button>
          </div>
        </div>`;

      const cancelBtn = overlay.querySelector('[data-role="cancel"]');
      const confirmBtn = overlay.querySelector('[data-role="confirm"]');
      overlay.querySelector(".modal-title").textContent = title;
      overlay.querySelector(".modal-message").textContent = message;
      cancelBtn.textContent = cancelLabel;
      confirmBtn.textContent = confirmLabel;

      function close(result) {
        document.removeEventListener("keydown", onKeydown);
        overlay.remove();
        if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
        resolve(result);
      }

      function onKeydown(event) {
        if (event.key === "Escape") {
          event.preventDefault();
          close(false);
        } else if (event.key === "Tab") {
          const focusables = [cancelBtn, confirmBtn];
          const index = focusables.indexOf(document.activeElement);
          event.preventDefault();
          const next = event.shiftKey
            ? (index <= 0 ? focusables.length - 1 : index - 1)
            : (index === focusables.length - 1 ? 0 : index + 1);
          focusables[next].focus();
        }
      }

      cancelBtn.addEventListener("click", () => close(false));
      confirmBtn.addEventListener("click", () => close(true));
      overlay.addEventListener("click", (event) => { if (event.target === overlay) close(false); });
      document.addEventListener("keydown", onKeydown);

      document.body.appendChild(overlay);
      (danger ? cancelBtn : confirmBtn).focus();
    });
  },

  toast(message) {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(App._toastTimer);
    App._toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  },

  async currentUser() {
    try {
      const { user } = await App.api("/api/auth/me");
      return user;
    } catch {
      return null;
    }
  }
};

if ("serviceWorker" in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing || !hadController) return;
    refreshing = true;
    window.location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
