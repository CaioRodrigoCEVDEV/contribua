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
