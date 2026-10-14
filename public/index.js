(function () {
  const tabLogin = document.getElementById("tab-login");
  const tabRegister = document.getElementById("tab-register");
  const formLogin = document.getElementById("form-login");
  const formRegister = document.getElementById("form-register");

  App.currentUser().then((user) => {
    if (user) window.location.replace("/dashboard");
  });

  function selectTab(tab) {
    const isLogin = tab === "login";
    tabLogin.classList.toggle("active", isLogin);
    tabRegister.classList.toggle("active", !isLogin);
    formLogin.hidden = !isLogin;
    formRegister.hidden = isLogin;
  }

  tabLogin.addEventListener("click", () => selectTab("login"));
  tabRegister.addEventListener("click", () => selectTab("register"));

  function formValues(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  formLogin.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = formLogin.querySelector("button");
    button.disabled = true;
    try {
      await App.api("/api/auth/login", { method: "POST", body: formValues(formLogin) });
      window.location.replace("/dashboard");
    } catch (error) {
      App.toast(error.message);
      button.disabled = false;
    }
  });

  formRegister.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = formRegister.querySelector("button");
    button.disabled = true;
    try {
      await App.api("/api/auth/register", { method: "POST", body: formValues(formRegister) });
      window.location.replace("/dashboard");
    } catch (error) {
      App.toast(error.message);
      button.disabled = false;
    }
  });
})();
