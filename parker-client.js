/**
 * Parker CRM client — direct HTTP interaction from the service worker.
 *
 * Replaces parker_api.py by talking to Parker's Rails web interface
 * directly via fetch() (permitted by host_permissions in manifest.json).
 * Session cookies are managed automatically by the browser's cookie jar.
 */

import {
  extractCsrfToken,
  normalizeLinkedinUrl,
  namesFromLinkedinUrl,
  parseCandidatePage,
  findLinkedInMatchInSearchResults,
  findOwnerIdForEmail,
} from "./html-parser.js";

const PARKER_BASE = "https://parker.candidatelabs.com";

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * POST form-encoded data to a Parker URL.
 * Mirrors Python's requests.post(url, data={...}, allow_redirects=True).
 */
async function postForm(url, formData) {
  const body = new URLSearchParams(formData);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    credentials: "include",
    redirect: "follow",
  });
  return response;
}

/**
 * GET a Parker page with credentials (session cookie).
 */
async function getPage(url) {
  return fetch(url, {
    credentials: "include",
    redirect: "follow",
  });
}

// ── Authentication ───────────────────────────────────────────────────────

/**
 * Check if we're currently logged in to Parker.
 * Hits the root page and checks for a sign-out link.
 */
export async function isLoggedIn() {
  try {
    const r = await getPage(`${PARKER_BASE}/`);
    if (!r.ok) return false;
    if (r.url.includes("sign_in")) return false;
    const html = await r.text();
    return html.includes("sign_out");
  } catch {
    return false;
  }
}

/**
 * Perform the actual Parker login (Devise session).
 * Returns { ok: true } on success, { ok: false, error: '...' } on failure.
 */
export async function doLogin(email, password) {
  try {
    // Get the sign-in page to extract CSRF token
    const signInPage = await getPage(`${PARKER_BASE}/users/sign_in`);
    const signInHtml = await signInPage.text();
    const token = extractCsrfToken(signInHtml);

    if (!token) {
      return { ok: false, error: "Could not extract CSRF token from login page." };
    }

    // Submit the login form
    const r = await postForm(`${PARKER_BASE}/users/sign_in`, {
      authenticity_token: token,
      "user[email]": email,
      "user[password]": password,
      commit: "Sign in",
    });

    if (r.ok && !r.url.includes("sign_in")) {
      return { ok: true, message: "Logged in to Parker." };
    }
    return { ok: false, error: "Login failed. Check email/password." };
  } catch (err) {
    return { ok: false, error: err.message || "Could not connect to Parker." };
  }
}

/**
 * Ensure we have an active Parker session.
 * Auto-logins using stored credentials if session expired.
 * Returns true if authenticated, false otherwise.
 */
export async function ensureLoggedIn() {
  if (await isLoggedIn()) return true;

  // Try auto-login with stored credentials
  const { parkerEmail, parkerPassword } = await chrome.storage.sync.get([
    "parkerEmail",
    "parkerPassword",
  ]);
  if (!parkerEmail || !parkerPassword) return false;

  const result = await doLogin(parkerEmail, parkerPassword);
  return result.ok === true;
}

// ── Candidate Lookup ─────────────────────────────────────────────────────

/**
 * Strategy 1: Use Parker's built-in LinkedIn URL check.
 * Returns parsed candidate data or null.
 */
async function lookupByUrlCheck(linkedinUrl) {
  try {
    const checkPage = await getPage(
      `${PARKER_BASE}/candidates/linkedin_url_check`
    );
    if (!checkPage.ok) return null;
    const checkHtml = await checkPage.text();
    const token = extractCsrfToken(checkHtml);

    const r = await postForm(
      `${PARKER_BASE}/candidates/check_linkedin_url`,
      { authenticity_token: token, linkedin_url: linkedinUrl }
    );

    const html = await r.text();
    if (r.ok && /\/candidates\/\d+$/.test(r.url)) {
      return parseCandidatePage(html, r.url);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Strategy 2: Search by name parts extracted from the LinkedIn URL slug.
 * Returns parsed candidate data or null.
 */
async function lookupByNameSearch(linkedinUrl) {
  const nameParts = namesFromLinkedinUrl(linkedinUrl);
  if (!nameParts.length) return null;

  const normalizedTarget = normalizeLinkedinUrl(linkedinUrl);

  for (const namePart of nameParts) {
    try {
      const params = new URLSearchParams({
        "q[first_name_or_last_name_cont]": namePart,
        commit: "Search",
      });
      const r = await getPage(`${PARKER_BASE}/candidates?${params}`);
      if (!r.ok) continue;

      const html = await r.text();
      const candidatePath = findLinkedInMatchInSearchResults(html, linkedinUrl);
      if (candidatePath) {
        const detail = await getPage(`${PARKER_BASE}${candidatePath}`);
        if (detail.ok) {
          const detailHtml = await detail.text();
          return parseCandidatePage(detailHtml, detail.url);
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Strategy 3: Search by explicit first/last name from the LinkedIn page.
 * Handles URL slugs without hyphens (e.g. /in/anshulsaha).
 * Returns parsed candidate data or null.
 */
async function lookupByExplicitName(linkedinUrl, firstName, lastName) {
  const searchTerms = [firstName, lastName].filter((n) => n && n.trim());
  if (!searchTerms.length) return null;

  for (const term of searchTerms) {
    try {
      const params = new URLSearchParams({
        "q[first_name_or_last_name_cont]": term.trim(),
        commit: "Search",
      });
      const r = await getPage(`${PARKER_BASE}/candidates?${params}`);
      if (!r.ok) continue;

      const html = await r.text();
      const candidatePath = findLinkedInMatchInSearchResults(html, linkedinUrl);
      if (candidatePath) {
        const detail = await getPage(`${PARKER_BASE}${candidatePath}`);
        if (detail.ok) {
          const detailHtml = await detail.text();
          return parseCandidatePage(detailHtml, detail.url);
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Look up a candidate in Parker by LinkedIn URL.
 * Tries three strategies in order:
 *   1. Parker's built-in URL check
 *   2. Name search from URL slug
 *   3. Name search from explicit first/last name
 */
export async function lookupCandidate(linkedinUrl, firstName = "", lastName = "") {
  try {
    const loggedIn = await ensureLoggedIn();
    if (!loggedIn) {
      return {
        error: "Not authenticated with Parker. Open extension settings to configure credentials.",
      };
    }

    // Strategy 1: Parker's URL check
    let candidate = await lookupByUrlCheck(linkedinUrl);
    if (candidate) {
      candidate.linkedin_url = candidate.linkedin_url || linkedinUrl;
      return { found: true, candidate };
    }

    // Strategy 2: Name-based search from URL slug
    candidate = await lookupByNameSearch(linkedinUrl);
    if (candidate) {
      candidate.linkedin_url = candidate.linkedin_url || linkedinUrl;
      return { found: true, candidate };
    }

    // Strategy 3: Search using explicit first/last name from page
    if (firstName || lastName) {
      candidate = await lookupByExplicitName(linkedinUrl, firstName, lastName);
      if (candidate) {
        candidate.linkedin_url = candidate.linkedin_url || linkedinUrl;
        return { found: true, candidate };
      }
    }

    return { found: false };
  } catch (err) {
    return { error: err.message || "Failed to look up candidate." };
  }
}

// ── Candidate Creation ───────────────────────────────────────────────────

/**
 * Create a stub candidate in Parker.
 * Automatically sets owner and sourced_by to the logged-in user.
 */
export async function createCandidate({
  firstName,
  lastName,
  linkedinUrl,
  sourcedDate,
}) {
  try {
    const loggedIn = await ensureLoggedIn();
    if (!loggedIn) {
      return { ok: false, error: "Not authenticated with Parker." };
    }

    // GET the new-candidate form directly (avoids the check_linkedin_url
    // redirect chain which can break CSRF token/session synchronisation
    // in the service worker's fetch).
    const newPage = await getPage(`${PARKER_BASE}/candidates/new`);
    if (!newPage.ok) {
      return { ok: false, error: `Could not load create form (HTTP ${newPage.status}).` };
    }
    const newHtml = await newPage.text();

    const createToken = extractCsrfToken(newHtml);
    if (!createToken) {
      return { ok: false, error: "Could not extract CSRF token from create form." };
    }

    const sourced = sourcedDate || new Date().toISOString().split("T")[0];

    // Use the logged-in user's own email to auto-detect their owner ID
    const { parkerEmail } = await chrome.storage.sync.get("parkerEmail");
    const ownerId = findOwnerIdForEmail(newHtml, parkerEmail || "");

    const payload = {
      authenticity_token: createToken,
      "candidate[first_name]": firstName,
      "candidate[last_name]": lastName,
      "candidate[linkedin_url]": linkedinUrl,
      "candidate[sourced_date]": sourced,
      commit: "Create Candidate",
    };

    // Set owner and sourced_by to the current user
    if (ownerId) {
      payload["candidate[candidate_owner_id]"] = ownerId;
      payload["candidate[sourced_by_id]"] = ownerId;
    }

    const createResp = await postForm(`${PARKER_BASE}/candidates`, payload);
    const createHtml = await createResp.text();

    if (createResp.ok && /\/candidates\/\d+/.test(createResp.url)) {
      const candidate = parseCandidatePage(createHtml, createResp.url);
      return { ok: true, alreadyExisted: false, candidate };
    }

    // Try to extract an error message from the response.
    // Parker wraps errors in nested HTML (e.g. <div class="alert"><ul><li>...</li></ul></div>)
    // so we grab the whole error block and strip tags.
    const errorBlockMatch = createHtml.match(
      /class="[^"]*(?:error|alert)[^"]*"[^>]*>([\s\S]*?)<\/div>/i
    );
    let errorMsg = `HTTP ${createResp.status}`;
    if (errorBlockMatch) {
      const stripped = errorBlockMatch[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      if (stripped) errorMsg = stripped;
    }
    return { ok: false, error: `Parker rejected the candidate: ${errorMsg}` };
  } catch (err) {
    return { ok: false, error: err.message || "Failed to create candidate." };
  }
}
