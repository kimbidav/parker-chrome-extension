/**
 * Onboarding script — first-run setup for Parker LinkedIn Lookup.
 * Saves credentials and tests the connection to Parker.
 */

document.addEventListener("DOMContentLoaded", () => {
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const btn = document.getElementById("btn-connect");
  const statusEl = document.getElementById("status");

  btn.addEventListener("click", async () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      statusEl.textContent = "Please enter both email and password.";
      statusEl.className = "status error";
      return;
    }

    btn.disabled = true;
    btn.textContent = "Connecting\u2026";
    statusEl.textContent = "Testing connection to Parker\u2026";
    statusEl.className = "status info";

    // Save credentials
    await chrome.runtime.sendMessage({
      type: "SAVE_SETTINGS",
      settings: { parkerEmail: email, parkerPassword: password },
    });

    // Test login
    try {
      const result = await chrome.runtime.sendMessage({ type: "PARKER_LOGIN" });

      if (result.ok) {
        statusEl.textContent = "Connected! You can close this tab and start using the extension.";
        statusEl.className = "status success";
        btn.textContent = "Connected";
      } else {
        statusEl.textContent = result.error || "Login failed. Check your credentials.";
        statusEl.className = "status error";
        btn.disabled = false;
        btn.textContent = "Connect to Parker";
      }
    } catch (err) {
      statusEl.textContent = err.message || "Could not connect to Parker.";
      statusEl.className = "status error";
      btn.disabled = false;
      btn.textContent = "Connect to Parker";
    }
  });

  // Allow Enter key to submit
  passwordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") btn.click();
  });
});
