const form = document.getElementById("login-form");
const submit = document.getElementById("submit");
const error = document.getElementById("error");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submit.disabled = true;
  error.textContent = "";
  try {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: document.getElementById("password").value }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(response.status === 429
        ? "Demasiados intentos. Espera 15 minutos."
        : (body.error === "invalid password" ? "Contraseña incorrecta." : "No se pudo iniciar sesión."));
    }
    location.replace("/admin");
  } catch (err) {
    error.textContent = err.message;
    submit.disabled = false;
  }
});
