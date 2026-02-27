/**
 * Background service worker for Parker LinkedIn Lookup extension.
 *
 * Routes messages between the popup/content scripts and the Parker
 * client module. All Parker interactions happen directly via fetch()
 * — no local proxy server needed.
 */

import {
  isLoggedIn,
  doLogin,
  ensureLoggedIn,
  lookupCandidate,
  createCandidate,
} from "./parker-client.js";

// ── Message listener ─────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = async () => {
    switch (msg.type) {
      case "LOOKUP_CANDIDATE": {
        return await lookupCandidate(
          msg.linkedinUrl,
          msg.firstName,
          msg.lastName
        );
      }

      case "CREATE_CANDIDATE": {
        return await createCandidate(msg.data);
      }

      case "PARKER_LOGIN": {
        const { parkerEmail, parkerPassword } = await chrome.storage.sync.get([
          "parkerEmail",
          "parkerPassword",
        ]);
        if (!parkerEmail || !parkerPassword) {
          return {
            ok: false,
            error: "Configure credentials in extension settings.",
          };
        }
        return await doLogin(parkerEmail, parkerPassword);
      }

      case "CHECK_AUTH_STATUS": {
        const authenticated = await isLoggedIn();
        return { authenticated };
      }

      case "SAVE_SETTINGS": {
        await chrome.storage.sync.set(msg.settings);
        return { ok: true };
      }

      case "GET_SETTINGS": {
        return await chrome.storage.sync.get([
          "parkerEmail",
          "parkerPassword",
        ]);
      }

      case "PROFILE_PAGE_LOADED": {
        return {};
      }

      default:
        return { error: "Unknown message type" };
    }
  };

  handler().then(sendResponse);
  return true; // keep channel open for async sendResponse
});

// ── First-run onboarding ─────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    const { parkerEmail } = await chrome.storage.sync.get("parkerEmail");
    if (!parkerEmail) {
      chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
    }
  }
});
