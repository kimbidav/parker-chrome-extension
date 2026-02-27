/**
 * Regex-based HTML extraction helpers for Parker CRM pages.
 *
 * Replaces the BeautifulSoup parsing from parker_api.py.
 * Each function targets specific, well-defined HTML patterns
 * in Parker's Rails-rendered pages.
 */

/**
 * Extract Rails CSRF authenticity_token from page HTML.
 * Checks <meta name="csrf-token"> and <input name="authenticity_token">.
 */
export function extractCsrfToken(html) {
  let m = html.match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/);
  if (m) return decodeHtmlEntities(m[1]);
  m = html.match(/<input[^>]*name="authenticity_token"[^>]*value="([^"]+)"/);
  if (m) return decodeHtmlEntities(m[1]);
  m = html.match(/<input[^>]*value="([^"]+)"[^>]*name="authenticity_token"/);
  return m ? decodeHtmlEntities(m[1]) : "";
}

/**
 * Decode common HTML entities in a string.
 * Rails may encode special characters in CSRF token attributes.
 */
function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2[Bb];/g, "+")
    .replace(/&#43;/g, "+")
    .replace(/&#x2[Ff];/g, "/")
    .replace(/&#47;/g, "/")
    .replace(/&#61;/g, "=")
    .replace(/&#x3[Dd];/g, "=");
}

/**
 * Normalize a LinkedIn URL for comparison.
 * Lowercases, strips www, ensures https, removes trailing slash.
 */
export function normalizeLinkedinUrl(url) {
  url = url.toLowerCase().trim();
  url = url.replace("https://www.linkedin.com", "https://linkedin.com");
  url = url.replace("http://www.linkedin.com", "https://linkedin.com");
  url = url.replace("http://linkedin.com", "https://linkedin.com");
  return url.replace(/\/+$/, "");
}

/**
 * Extract searchable name parts from a LinkedIn URL slug.
 * e.g. '/in/kaidi-cao-398131117' -> ['kaidi', 'cao']
 */
export function namesFromLinkedinUrl(url) {
  const m = url.match(/\/in\/([^/?]+)/);
  if (!m) return [];
  let slug = m[1];
  // Remove trailing LinkedIn ID suffixes — purely numeric or alphanumeric
  // e.g. '-398131117' or '-b166a9171'
  slug = slug.replace(/-[a-z]?\d{5,}\d*$/i, "");
  // Split on hyphens, keep parts longer than 1 char
  return slug.split("-").filter((p) => p && p.length > 1);
}

/**
 * Parse a Parker candidate detail page (/candidates/<id>).
 * Extracts: id, url, name, current_owner, location, timeline, linkedin_url, submissions.
 */
export function parseCandidatePage(html, finalUrl) {
  const data = {};

  // Candidate ID from URL
  const cidMatch = finalUrl.match(/\/candidates\/(\d+)/);
  data.id = cidMatch ? cidMatch[1] : "";
  data.url = finalUrl;

  // Name from <h1>
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) {
    data.name = h1Match[1].replace(/<[^>]*>/g, "").trim();
  }

  // Sourced By — Parker uses <dt>label</dt><dd>value</dd> pairs.
  const sourcedByMatch = html.match(
    /Sourced\s+By<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/i
  );
  if (sourcedByMatch) {
    const sourcedByText = sourcedByMatch[1].replace(/<[^>]*>/g, "").trim();
    if (sourcedByText) {
      data.sourced_by = sourcedByText;
    }
  }

  // Current Owner — same <dt>/<dd> pattern
  const ownerMatch = html.match(
    /Current\s+Owner<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/i
  );
  if (ownerMatch) {
    const ownerText = ownerMatch[1].replace(/<[^>]*>/g, "").trim();
    if (ownerText) {
      data.current_owner = ownerText;
    }
  }

  // Location — same <dt>/<dd> pattern
  const locationMatch = html.match(
    />\s*Location<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/i
  );
  if (locationMatch) {
    const loc = locationMatch[1].replace(/<[^>]*>/g, "").trim();
    if (loc && loc !== "N/A") {
      data.location = loc;
    }
  }

  // Timeline events
  const timelineLabels = [
    "Sourced",
    "First Engaged",
    "Handed Off",
    "First screened",
    "First Submitted",
    "Most Recently Submitted",
  ];
  data.timeline = timelineLabels.map((label) => {
    // Look for the label followed by a date (MM/DD/YY or MM/DD/YYYY) within
    // a reasonable distance in the HTML
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped + "[\\s\\S]{0,300}?(\\d{1,2}/\\d{1,2}/\\d{2,4})", "i");
    const m = html.match(re);
    return { label, date: m ? m[1] : "N/A" };
  });

  // LinkedIn URL
  const liMatch = html.match(/href="([^"]*linkedin\.com\/in\/[^"]+)"/i);
  if (liMatch) {
    data.linkedin_url = liMatch[1];
  }

  // Submissions table — find <table>, skip header row, extract cells
  data.submissions = parseSubmissionsTable(html);

  return data;
}

/**
 * Parse the submissions table from a candidate detail page.
 */
function parseSubmissionsTable(html) {
  const submissions = [];
  // Find the table
  const tableMatch = html.match(/<table[\s\S]*?>([\s\S]*?)<\/table>/i);
  if (!tableMatch) return submissions;

  const tableHtml = tableMatch[1];
  // Match each <tr> (skip first which is header)
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  let isFirst = true;
  while ((rowMatch = rowPattern.exec(tableHtml)) !== null) {
    if (isFirst) {
      isFirst = false;
      continue;
    }
    const cells = [];
    const cellPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellPattern.exec(rowMatch[1])) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]*>/g, "").trim());
    }
    if (cells.length >= 5) {
      submissions.push({
        role: cells[0],
        company: cells[1],
        stage: cells[2],
        dates: cells[3],
        owner: cells[4],
      });
    }
  }
  return submissions;
}

/**
 * Scan search results HTML for a row whose LinkedIn URL matches the target.
 * Returns the relative candidate path (e.g. '/candidates/12345') or null.
 */
export function findLinkedInMatchInSearchResults(html, targetLinkedinUrl) {
  const normalizedTarget = normalizeLinkedinUrl(targetLinkedinUrl);

  // Find the table in the search results
  const tableMatch = html.match(/<table[\s\S]*?>([\s\S]*?)<\/table>/i);
  if (!tableMatch) return null;

  const tableHtml = tableMatch[1];
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  let isFirst = true;
  while ((rowMatch = rowPattern.exec(tableHtml)) !== null) {
    if (isFirst) {
      isFirst = false;
      continue;
    }
    const rowHtml = rowMatch[1];

    // Check for LinkedIn URL in this row
    const liMatch = rowHtml.match(/href="([^"]*linkedin\.com\/in\/[^"]+)"/i);
    if (!liMatch) continue;

    if (normalizeLinkedinUrl(liMatch[1]) === normalizedTarget) {
      // Found a match — extract the candidate page link
      const candMatch = rowHtml.match(/href="(\/candidates\/\d+)"/);
      if (candMatch) return candMatch[1];
    }
  }
  return null;
}

/**
 * Find the owner ID in the create-candidate form's dropdown
 * that matches the given email address.
 */
export function findOwnerIdForEmail(html, email) {
  if (!email) return "";

  // Extract the owner <select> element
  const selectMatch = html.match(
    /<select[^>]*name="candidate\[candidate_owner_id\]"[^>]*>([\s\S]*?)<\/select>/i
  );
  if (!selectMatch) return "";

  const optionPattern = /<option[^>]*value="(\d+)"[^>]*>([^<]*)<\/option>/gi;
  let m;
  while ((m = optionPattern.exec(selectMatch[1])) !== null) {
    if (m[2].trim().toLowerCase() === email.toLowerCase()) {
      return m[1];
    }
  }
  return "";
}
