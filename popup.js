/**
 * Popup script for Parker LinkedIn Lookup.
 *
 * Flow:
 *  1. On open, check if credentials are configured.
 *  2. Check if we're on a LinkedIn /in/ page.
 *  3. If yes, ask the content script for profile data, then ask the
 *     background worker to look up the candidate in Parker.
 *  4. Show the appropriate state: found / not-found / error.
 *  5. Handle create-candidate and settings interactions.
 */

document.addEventListener("DOMContentLoaded", init);

// ---- DOM refs -----------------------------------------------------------
const $ = (id) => document.getElementById(id);

const mainView = $("main-view");
const settingsView = $("settings-view");

const stateSetup = $("state-setup");
const stateNotLinkedIn = $("state-not-linkedin");
const stateLoading = $("state-loading");
const stateFound = $("state-found");
const stateNotFound = $("state-not-found");
const stateCreated = $("state-created");
const stateError = $("state-error");

// ---- State management ---------------------------------------------------

function showState(stateEl) {
  [stateSetup, stateNotLinkedIn, stateLoading, stateFound, stateNotFound, stateCreated, stateError]
    .forEach((el) => el.classList.add("hidden"));
  stateEl.classList.remove("hidden");
}

// ---- Init ---------------------------------------------------------------

async function init() {
  // Wire up events
  $("settings-toggle").addEventListener("click", openSettings);
  $("btn-cancel-settings").addEventListener("click", closeSettings);
  $("btn-save-settings").addEventListener("click", saveSettings);
  $("btn-test-login").addEventListener("click", testLogin);
  $("btn-create").addEventListener("click", createCandidate);
  $("btn-retry").addEventListener("click", () => checkCurrentTab());
  $("btn-open-settings").addEventListener("click", openSettings);

  // Default sourced date = today
  $("field-date").value = new Date().toISOString().split("T")[0];

  // Check if credentials are configured
  const settings = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  if (!settings.parkerEmail || !settings.parkerPassword) {
    showState(stateSetup);
    return;
  }

  await checkCurrentTab();
}

// ---- Core flow ----------------------------------------------------------

async function checkCurrentTab() {
  showState(stateLoading);

  // 1. Get the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url || !tab.url.match(/linkedin\.com\/in\//)) {
    showState(stateNotLinkedIn);
    return;
  }

  // 2. Ask the content script for profile data
  let profileData;
  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "GET_PROFILE_DATA",
    });
    profileData = response?.data;
  } catch {
    // Content script might not be injected yet — fall back to URL only
    const url = new URL(tab.url);
    profileData = {
      linkedinUrl: `https://www.linkedin.com${url.pathname.replace(/\/+$/, "")}`,
      firstName: "",
      lastName: "",
    };
  }

  if (!profileData || !profileData.linkedinUrl) {
    showState(stateNotLinkedIn);
    return;
  }

  // 3. Look up in Parker
  try {
    const result = await chrome.runtime.sendMessage({
      type: "LOOKUP_CANDIDATE",
      linkedinUrl: profileData.linkedinUrl,
      firstName: profileData.firstName,
      lastName: profileData.lastName,
    });

    if (result.error) {
      showError(result.error);
      return;
    }

    if (result.found) {
      // Candidate exists — render rich detail card
      const c = result.candidate || {};
      $("found-name").textContent = c.name || "Candidate";
      $("found-owner").textContent = c.current_owner ? `Owner: ${c.current_owner}` : "";
      $("found-link").href = c.url || "#";
      renderTimeline(c.timeline || []);
      showState(stateFound);
    } else {
      // Not found — prefill create form
      $("field-first").value = profileData.firstName;
      $("field-last").value = profileData.lastName;
      $("field-url").value = profileData.linkedinUrl;
      showState(stateNotFound);
    }
  } catch (err) {
    showError(err.message || "Could not connect to Parker.");
  }
}

// ---- Create candidate ---------------------------------------------------

async function createCandidate() {
  const btn = $("btn-create");
  btn.disabled = true;
  btn.textContent = "Creating\u2026";

  const data = {
    firstName: $("field-first").value.trim(),
    lastName: $("field-last").value.trim(),
    linkedinUrl: $("field-url").value.trim(),
    sourcedDate: $("field-date").value,
  };

  if (!data.firstName || !data.lastName) {
    btn.disabled = false;
    btn.textContent = "Create Candidate";
    showError("First and last name are required.");
    return;
  }

  try {
    const result = await chrome.runtime.sendMessage({
      type: "CREATE_CANDIDATE",
      data,
    });

    if (result.ok) {
      $("created-link").href = result.candidate?.url || "#";
      showState(stateCreated);
    } else {
      showError(result.error || "Failed to create candidate.");
      btn.disabled = false;
      btn.textContent = "Create Candidate";
    }
  } catch (err) {
    showError(err.message || "Failed to create candidate.");
    btn.disabled = false;
    btn.textContent = "Create Candidate";
  }
}

// ---- Timeline rendering -------------------------------------------------

function renderTimeline(events) {
  const container = $("found-timeline");
  container.innerHTML = "";

  if (!events || events.length === 0) return;

  for (const evt of events) {
    const row = document.createElement("div");
    row.className = "timeline-row";

    const hasDate = evt.date && evt.date !== "N/A";

    const dot = document.createElement("span");
    dot.className = `timeline-dot ${hasDate ? "done" : "pending"}`;
    row.appendChild(dot);

    const label = document.createElement("span");
    label.className = "timeline-label";
    label.textContent = evt.label;
    row.appendChild(label);

    const dateEl = document.createElement("span");
    dateEl.className = `timeline-date ${hasDate ? "" : "na"}`;
    dateEl.textContent = evt.date || "N/A";
    row.appendChild(dateEl);

    container.appendChild(row);
  }
}

// ---- Error handling -----------------------------------------------------

function showError(message) {
  $("error-message").textContent = message;
  showState(stateError);
}

// ---- Settings -----------------------------------------------------------

async function openSettings() {
  mainView.classList.add("hidden");
  settingsView.classList.remove("hidden");
  $("settings-status").textContent = "";

  // Load current settings
  const settings = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  $("setting-email").value = settings.parkerEmail || "";
  $("setting-password").value = settings.parkerPassword || "";
}

function closeSettings() {
  settingsView.classList.add("hidden");
  mainView.classList.remove("hidden");
}

async function saveSettings() {
  const settings = {
    parkerEmail: $("setting-email").value.trim(),
    parkerPassword: $("setting-password").value,
  };

  await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings });
  $("settings-status").textContent = "Settings saved.";
  $("settings-status").style.color = "#34c759";
  setTimeout(() => {
    closeSettings();
    checkCurrentTab();
  }, 800);
}

async function testLogin() {
  const statusEl = $("settings-status");
  statusEl.textContent = "Testing\u2026";
  statusEl.style.color = "#86868b";

  // Save first so background picks up new creds
  await saveSettings();

  // Small delay so save completes
  await new Promise((r) => setTimeout(r, 200));

  try {
    const result = await chrome.runtime.sendMessage({ type: "PARKER_LOGIN" });
    if (result.ok) {
      statusEl.textContent = "Logged in successfully.";
      statusEl.style.color = "#34c759";
    } else {
      statusEl.textContent = result.error || "Login failed.";
      statusEl.style.color = "#ff3b30";
    }
  } catch (err) {
    statusEl.textContent = err.message || "Could not connect to Parker.";
    statusEl.style.color = "#ff3b30";
  }
}
