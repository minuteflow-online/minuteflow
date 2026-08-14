async function init() {
  // If a session is already persisted from a previous launch, skip straight
  // to the dashboard instead of showing the login form.
  const existing = await window.mfAuth.getSession();
  if (existing.ok) {
    await window.mfAuth.goDashboard();
    return;
  }

  document.getElementById("login-form").addEventListener("submit", onSubmit);
}

async function onSubmit(event) {
  event.preventDefault();

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const errorEl = document.getElementById("error");
  const button = document.getElementById("submit-btn");

  errorEl.textContent = "";
  button.disabled = true;
  button.textContent = "Signing in…";

  const result = await window.mfAuth.login(email, password);

  if (!result.ok) {
    errorEl.textContent = result.error || "Login failed. Check your email and password.";
    button.disabled = false;
    button.textContent = "Log In";
    return;
  }

  await window.mfAuth.goDashboard();
}

document.addEventListener("DOMContentLoaded", init);
