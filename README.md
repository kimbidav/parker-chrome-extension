# Parker LinkedIn Lookup

Chrome extension that checks if a LinkedIn profile exists in Parker CRM. View the candidate record or create a new one in one click.

## Features

- **Automatic lookup**: Visit any LinkedIn profile and the sidebar shows whether the candidate is already in Parker
- **One-click creation**: Add new candidates to Parker directly from LinkedIn with your name set as owner
- **Per-user credentials**: Each team member logs in with their own Parker email and password
- **No server required**: Talks directly to Parker's web interface from the browser — no Python, no proxy, no terminal

## Install

1. Download or clone this repository
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select this folder
5. Click the extension icon and enter your Parker email and password

## How it works

When you visit a LinkedIn `/in/` profile page, the extension:

1. Extracts the candidate's name and LinkedIn URL from the page
2. Searches Parker using three strategies (URL check, URL slug name search, explicit name search)
3. If found: displays the candidate card with owner, timeline, and a link to Parker
4. If not found: shows a create form pre-filled with the candidate's details

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Extension config, permissions, declarative net request rules |
| `parker-client.js` | All Parker HTTP interactions (login, lookup, create) |
| `html-parser.js` | Regex-based extraction of data from Parker's HTML pages |
| `background.js` | Service worker message router |
| `content.js` | LinkedIn page sidebar injection and profile data extraction |
| `popup.html` / `popup.js` | Extension popup UI |
| `onboarding.html` / `onboarding.js` | First-run setup page |
| `rules.json` | Network rules to set correct Origin header on POST requests |
| `styles.css` | Shared styles for popup and sidebar |

## Technical notes

- Built on Manifest V3 with ES module service worker
- Uses `host_permissions` for `parker.candidatelabs.com` to make authenticated `fetch()` calls directly from the service worker
- Uses `declarativeNetRequest` to rewrite the `Origin` header on POST requests (Rails CSRF protection rejects `chrome-extension://` origins)
- Session cookies are managed by the browser's cookie jar — no explicit cookie handling needed
- Candidate owner is auto-detected from the logged-in user's email in Parker's form dropdown
