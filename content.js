/**
 * Content script — runs on LinkedIn profile pages (linkedin.com/in/*)
 *
 * Injects a sidebar panel that automatically looks up the current
 * LinkedIn profile in Parker CRM and displays the result.
 */

(() => {
  "use strict";

  // Prevent double-injection (LinkedIn is a SPA)
  if (document.getElementById("parker-sidebar-host")) return;

  // ── Profile data extraction ──────────────────────────────────────────

  function getCleanLinkedInUrl() {
    const url = new URL(window.location.href);
    let path = url.pathname.replace(/\/+$/, "");
    return `https://www.linkedin.com${path}`;
  }

  function extractProfileName() {
    // Try multiple selectors — LinkedIn changes layouts frequently
    const selectors = [
      "#workspace h2",                              // recruiter / 2025+ layout (from XPATH)
      "h1.text-heading-xlarge",                     // 2024+ layout
      "h2.text-heading-xlarge",                     // 2025 h2 variant
      ".pv-text-details__left-panel h1",            // classic layout
      ".pv-text-details__left-panel h2",            // classic h2 variant
      "div.mt2 h1",                                 // alternate layout
      "div.mt2 h2",                                 // alternate h2 variant
      "section.pv-top-card h1",                     // top card
      "section.pv-top-card h2",                     // top card h2
      "h1",                                          // last resort h1
      "h2",                                          // last resort h2
    ];
    let heading = null;
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim()) {
        // Sanity check: name should be short-ish and not a section title
        const text = el.innerText.trim();
        if (text.length < 60 && !text.includes("\n")) {
          heading = el;
          break;
        }
      }
    }
    if (!heading) return { firstName: "", lastName: "" };
    const full = heading.innerText.trim();
    const parts = full.split(/\s+/);
    return {
      firstName: parts[0] || "",
      lastName: parts.slice(1).join(" ") || "",
    };
  }

  function getProfileData() {
    const { firstName, lastName } = extractProfileName();
    return { linkedinUrl: getCleanLinkedInUrl(), firstName, lastName };
  }

  // ── Sidebar UI ───────────────────────────────────────────────────────

  const host = document.createElement("div");
  host.id = "parker-sidebar-host";
  host.style.cssText = "all:initial; position:fixed; top:80px; right:0; z-index:2147483647; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "closed" });

  shadow.innerHTML = `
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }

  :host { font-size: 13px; color: #1d1d1f; }

  .parker-panel {
    width: 300px;
    max-height: calc(100vh - 100px);
    background: #fff;
    border-radius: 12px 0 0 12px;
    box-shadow: -2px 0 20px rgba(0,0,0,.12);
    overflow-y: auto;
    transition: transform .25s ease, opacity .25s ease;
    transform: translateX(0);
    opacity: 1;
  }
  .parker-panel.collapsed {
    transform: translateX(262px);
    opacity: .92;
  }

  /* Header */
  .header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 14px;
    background: #0a66c2;
    color: #fff;
    border-radius: 12px 0 0 0;
    cursor: pointer;
    user-select: none;
  }
  .header:hover { background: #004182; }
  .header-title { font-size: 13px; font-weight: 600; letter-spacing: -.2px; }
  .header-badge {
    font-size: 10px; font-weight: 700;
    padding: 2px 7px; border-radius: 10px;
    background: rgba(255,255,255,.25); color: #fff;
  }
  .header-badge.found { background: #34c759; }
  .header-badge.not-found { background: #ff9500; }
  .header-badge.error { background: #ff3b30; }
  .collapse-arrow {
    font-size: 14px; transition: transform .25s;
  }
  .collapsed .collapse-arrow { transform: rotate(180deg); }

  /* Body */
  .body { padding: 14px; }

  /* States */
  .state { display: none; flex-direction: column; gap: 10px; }
  .state.active { display: flex; }

  /* Loading */
  .spinner {
    width: 28px; height: 28px; margin: 8px auto;
    border: 3px solid #e5e5e7; border-top-color: #0a66c2;
    border-radius: 50%; animation: spin .7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .loading-text { text-align: center; color: #86868b; font-size: 12px; }

  /* Candidate card */
  .candidate-name { font-size: 15px; font-weight: 600; color: #1d1d1f; }
  .candidate-owner { font-size: 11px; color: #636366; margin-top: 2px; }
  .candidate-location { font-size: 11px; color: #86868b; margin-top: 1px; }

  /* Timeline */
  .timeline { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; }
  .timeline-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; color: #86868b; margin-bottom: 2px; }
  .timeline-row { display: flex; align-items: center; gap: 7px; font-size: 12px; padding: 2px 0; }
  .timeline-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .timeline-dot.done { background: #34c759; }
  .timeline-dot.pending { background: #d1d1d6; }
  .timeline-label { flex: 1; color: #3a3a3c; }
  .timeline-date { font-weight: 600; font-variant-numeric: tabular-nums; color: #1d1d1f; min-width: 60px; text-align: right; font-size: 11px; }
  .timeline-date.na { color: #aeaeb2; font-weight: 400; }

  /* Links / buttons */
  .parker-link {
    display: block; text-align: center;
    margin-top: 10px; padding: 8px 14px;
    background: #0a66c2; color: #fff;
    border-radius: 6px; text-decoration: none;
    font-size: 12px; font-weight: 500;
    transition: background .15s;
  }
  .parker-link:hover { background: #004182; }

  /* Not found */
  .not-found-icon { text-align: center; font-size: 28px; margin: 4px 0; }
  .not-found-text { text-align: center; color: #3a3a3c; font-size: 13px; }
  .form-row { display: flex; gap: 8px; }
  .form-field { display: flex; flex-direction: column; gap: 2px; flex: 1; }
  .form-field label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .4px; color: #86868b; }
  .form-field input {
    padding: 6px 8px; border: 1px solid #d1d1d6; border-radius: 5px;
    font-size: 12px; background: #fafafa; color: #1d1d1f;
    font-family: inherit;
  }
  .form-field input:focus { outline: none; border-color: #0a66c2; }
  .create-btn {
    display: block; width: 100%; text-align: center;
    margin-top: 6px; padding: 8px 14px;
    background: #ff9500; color: #fff;
    border: none; border-radius: 6px; cursor: pointer;
    font-size: 12px; font-weight: 500;
    transition: background .15s;
  }
  .create-btn:hover { background: #e08600; }
  .create-btn:disabled { opacity: .6; cursor: default; }

  /* Created / success */
  .success-icon { text-align: center; font-size: 28px; color: #34c759; }
  .success-text { text-align: center; color: #34c759; font-size: 13px; font-weight: 500; }

  /* Error */
  .error-text { text-align: center; color: #ff3b30; font-size: 12px; }
  .retry-btn {
    display: block; width: 100%; text-align: center;
    margin-top: 6px; padding: 8px 14px;
    background: #e5e5e7; color: #1d1d1f;
    border: none; border-radius: 6px; cursor: pointer;
    font-size: 12px; font-weight: 500;
  }
  .retry-btn:hover { background: #d1d1d6; }

  /* Divider */
  .divider { border: none; border-top: 1px solid #e5e5e7; margin: 10px 0; }
</style>

<div class="parker-panel" id="panel">
  <div class="header" id="header">
    <span class="header-title">Parker CRM</span>
    <span class="header-badge" id="badge">…</span>
    <span class="collapse-arrow" id="arrow">&#9654;</span>
  </div>
  <div class="body">
    <!-- Loading -->
    <div class="state active" id="state-loading">
      <div class="spinner"></div>
      <div class="loading-text">Checking Parker…</div>
    </div>

    <!-- Found -->
    <div class="state" id="state-found">
      <div class="candidate-name" id="cand-name"></div>
      <div class="candidate-owner" id="cand-owner"></div>
      <div class="candidate-location" id="cand-location"></div>
      <div class="timeline">
        <div class="timeline-title">Timeline</div>
        <div id="timeline-rows"></div>
      </div>
      <a class="parker-link" id="parker-link" href="#" target="_blank">Open in Parker</a>
    </div>

    <!-- Not found -->
    <div class="state" id="state-not-found">
      <div class="not-found-icon">&#128269;</div>
      <div class="not-found-text">Not in Parker yet</div>
      <div class="form-row">
        <div class="form-field">
          <label>First name</label>
          <input type="text" id="field-first" />
        </div>
        <div class="form-field">
          <label>Last name</label>
          <input type="text" id="field-last" />
        </div>
      </div>
      <button class="create-btn" id="btn-create">Create Candidate</button>
    </div>

    <!-- Created -->
    <div class="state" id="state-created">
      <div class="success-icon">&#10003;</div>
      <div class="success-text">Candidate created!</div>
      <a class="parker-link" id="created-link" href="#" target="_blank">Open in Parker</a>
    </div>

    <!-- Error -->
    <div class="state" id="state-error">
      <div class="error-text" id="error-msg">Something went wrong.</div>
      <button class="retry-btn" id="btn-retry">Retry</button>
    </div>
  </div>
</div>
`;

  // ── DOM refs inside shadow ────────────────────────────────────────────

  const $ = (sel) => shadow.querySelector(sel);
  const panel   = $("#panel");
  const header  = $("#header");
  const badge   = $("#badge");
  const arrow   = $("#arrow");

  const states = {
    loading:  $("#state-loading"),
    found:    $("#state-found"),
    notFound: $("#state-not-found"),
    created:  $("#state-created"),
    error:    $("#state-error"),
  };

  function showState(key) {
    Object.values(states).forEach((el) => el.classList.remove("active"));
    states[key].classList.add("active");
  }

  function setBadge(text, type) {
    badge.textContent = text;
    badge.className = "header-badge";
    if (type) badge.classList.add(type);
  }

  // ── Collapse toggle ───────────────────────────────────────────────────

  let collapsed = false;
  header.addEventListener("click", () => {
    collapsed = !collapsed;
    panel.classList.toggle("collapsed", collapsed);
  });

  // ── Lookup logic ──────────────────────────────────────────────────────

  async function doLookup() {
    showState("loading");
    setBadge("…", "");

    const profile = getProfileData();
    if (!profile.linkedinUrl) {
      showState("error");
      $("#error-msg").textContent = "Could not detect LinkedIn URL.";
      setBadge("ERR", "error");
      return;
    }

    try {
      const result = await chrome.runtime.sendMessage({
        type: "LOOKUP_CANDIDATE",
        linkedinUrl: profile.linkedinUrl,
        firstName: profile.firstName,
        lastName: profile.lastName,
      });

      if (result.error) {
        showState("error");
        $("#error-msg").textContent = result.error;
        setBadge("ERR", "error");
        return;
      }

      if (result.found) {
        const c = result.candidate || {};
        $("#cand-name").textContent = c.name || profile.firstName + " " + profile.lastName;
        $("#cand-owner").textContent = c.current_owner ? "Owner: " + c.current_owner : "";
        $("#cand-location").textContent = c.location || "";
        $("#parker-link").href = c.url || "#";

        // Render timeline
        const container = $("#timeline-rows");
        container.innerHTML = "";
        for (const evt of (c.timeline || [])) {
          const hasDate = evt.date && evt.date !== "N/A";
          const row = document.createElement("div");
          row.className = "timeline-row";
          row.innerHTML =
            `<span class="timeline-dot ${hasDate ? "done" : "pending"}"></span>` +
            `<span class="timeline-label">${evt.label}</span>` +
            `<span class="timeline-date ${hasDate ? "" : "na"}">${evt.date || "N/A"}</span>`;
          container.appendChild(row);
        }

        showState("found");
        setBadge("IN PARKER", "found");
      } else {
        // Pre-fill name fields
        $("#field-first").value = profile.firstName;
        $("#field-last").value = profile.lastName;
        showState("notFound");
        setBadge("NEW", "not-found");
      }
    } catch (err) {
      showState("error");
      $("#error-msg").textContent = err.message || "Could not connect to Parker.";
      setBadge("ERR", "error");
    }
  }

  // ── Create candidate ──────────────────────────────────────────────────

  $("#btn-create").addEventListener("click", async () => {
    const btn = $("#btn-create");
    const firstName = $("#field-first").value.trim();
    const lastName = $("#field-last").value.trim();

    if (!firstName || !lastName) {
      $("#error-msg").textContent = "First and last name are required.";
      showState("error");
      setBadge("ERR", "error");
      return;
    }

    btn.disabled = true;
    btn.textContent = "Creating…";

    const profile = getProfileData();
    try {
      const result = await chrome.runtime.sendMessage({
        type: "CREATE_CANDIDATE",
        data: {
          firstName,
          lastName,
          linkedinUrl: profile.linkedinUrl,
          sourcedDate: new Date().toISOString().split("T")[0],
        },
      });

      if (result.ok) {
        $("#created-link").href = result.candidate?.url || "#";
        showState("created");
        setBadge("CREATED", "found");
      } else {
        showState("error");
        $("#error-msg").textContent = result.error || "Failed to create candidate.";
        setBadge("ERR", "error");
      }
    } catch (err) {
      showState("error");
      $("#error-msg").textContent = err.message || "Create failed.";
      setBadge("ERR", "error");
    }

    btn.disabled = false;
    btn.textContent = "Create Candidate";
  });

  // ── Retry ─────────────────────────────────────────────────────────────

  $("#btn-retry").addEventListener("click", doLookup);

  // ── Respond to popup requests ─────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "GET_PROFILE_DATA") {
      sendResponse({ data: getProfileData() });
    }
  });

  // ── SPA navigation detection ──────────────────────────────────────────

  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (location.href.match(/linkedin\.com\/in\//)) {
        // Wait for new profile to render
        setTimeout(doLookup, 1500);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // ── Initial lookup ────────────────────────────────────────────────────

  // Small delay to let the page settle
  setTimeout(doLookup, 800);

})();
