# Chrome Web Store — Colonist Game Analyst

Use this doc when submitting the extension in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

**Regional eligibility:** Developer registration is only available in **countries Google supports** for this program. If your country is not in the signup form, you cannot publish on the store from that account until Google adds the region (or you arrange a **legitimate** publisher elsewhere). **Distribution without the store** — GitHub Releases + `npm run pack-extension` + users **Load unpacked** — is documented in the main [README](../README.md).

## Before you submit

1. **Privacy policy URL (required)**  
   The dashboard asks for a public **HTTPS** URL. Host the file [`privacy-policy.html`](privacy-policy.html) (same folder as this doc) on **GitHub Pages**, **your site**, or any static host.  
   Example after enabling GitHub Pages on the repo:  
   `https://<your-username>.github.io/<repo-name>/privacy-policy.html`  
   Update the “Last updated” date and contact email in that file first.

2. **Zip the extension** (only the `extension` folder, not this monorepo root):

   ```bash
   cd colonist-game-analyst/extension
   zip -r ../colonist-game-analyst-extension.zip .
   ```

   Upload `colonist-game-analyst-extension.zip`. The zip root must contain `manifest.json`.

3. **Screenshots** (required for listing quality): capture **1280×800** or **640×400** PNG/JPEG of the **side panel** on a game tab (VP table, hands, bank, etc.).  
   - At least **1** image; **5** is better.  
   - Optional: **440×280** small promo tile, **920×680** or **1400×560** marquee (if you want marquee placement).

4. **Iconset** — Master source is **`extension/icons/icon.png`** (square; e.g. **1024×1024**). Regenerate shipped sizes on macOS:

   ```bash
   cd extension/icons
   sips -z 128 128 icon.png --out icon-128.png
   sips -z 48 48 icon.png --out icon-48.png
   sips -z 16 16 icon.png --out icon-16.png
   ```

   Or run **`npm run regenerate-icons`**. If `icon.png` is not square, center-crop to a square first (see `sips --cropToHeightWidth` / `--cropOffset` in `man sips`).

   Release zips **omit** `icons/icon.png` and `icons/icon.png` so downloads stay small (only **`icon-16/48/128.png`** are needed at runtime).

---

## Package / distribution

| Field | Value |
|--------|--------|
| **Category** | Games (or Productivity if you prefer) |
| **Language** | English (add more if you localize) |

---

## Copy-paste: Store listing

### Short description (max 132 characters)

```
Read-only side panel for Colonist / Hexs: hands, bank, dice, trades, victory points — no automation.
```

(Character count: under 132. Adjust if needed.)

### Detailed description

```
Colonist Game Analyst adds a read-only side panel while you play on colonist.io or hexs.io. It helps you track the match in one place without clicking through menus.

WHAT IT SHOWS
• Hands — Resource totals per player derived from the in-game activity feed (gains, trades, discards, steals, starting cards), with support for hidden card backs where the UI does not reveal specifics.
• Bank — Live resource supply from decoded game data.
• Dice — Recent rolls.
• Trades & production — Trade wire mirror and production-oriented updates where available.
• Victory & awards — Public victory points and longest road / largest army from the wire, plus feed-based adjustments for Longest Road / Largest Army awards when the log shows +VP. Totals avoid double-counting when the server already includes those bonuses.
• Development cards & pieces — From wire when present.
• Export — Save session + tracker snapshot as JSON for your own analysis.

HOW IT WORKS
The extension decodes WebSocket traffic the page already uses and parses the on-screen activity feed. Everything is merged locally in your browser (session storage). It does not play for you, send moves, or phone home to a custom backend.

IMPORTANT
For personal analysis and fair play only. Not affiliated with Colonist. Follow Colonist’s terms of service.
```

---

## Single purpose

**Questionnaire (paraphrase):**  
This extension has a **single purpose**: to display a **read-only analytical side panel** for Colonist / Hexs matches—resource tracking, bank, dice, trades, and victory-related summaries—using data already available in the browser tab. It does not serve unrelated functionality.

---

## Permission justifications (dashboard text)

Use variations of the following if the form asks for each permission:

| Permission | Justification |
|------------|----------------|
| **scripting** | Inject the content script and game-log hook only on colonist.io / hexs.io URLs so decoded messages and feed parsing run in the correct frames. |
| **storage** | Store merged match state in `chrome.storage.session` so the side panel can read updates (service worker cannot message the panel directly). Data stays on the device and is cleared with the session. |
| **sidePanel** | Open the analyst UI in Chrome’s side panel when the user clicks the extension icon. |
| **tabs** | Find Colonist/Hexs tabs to register scripts when needed (`tabs` query / scripting targets). |
| **Host access** | **colonist.io** / **hexs.io** (and subdomains): limit all injection and WS observation to these game origins only. |

---

## Data safety / Privacy Practices form

- **Does the extension collect user data?** Typically: **No** — processing is local; no extension-operated server receives game content. If the store asks about “technical data,” answer honestly: only what Chrome already provides to extensions (e.g. tab URLs for permitted sites) for the features above.

- **Handling:** Data processed **locally**; not sold. Align wording with [`privacy-policy.html`](privacy-policy.html).

---

## After approval

- Tag the repo git version to match `manifest.json` `version`.
- Append a line to [`CHANGELOG.md`](../CHANGELOG.md) (“Chrome Web Store listing (initial publication)”) if you want release notes to mention it.
