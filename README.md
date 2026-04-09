# Colonist Game Analyst

A Chrome extension that opens a **read-only side panel** for [colonist.io](https://colonist.io) (and **hexs.io**). It merges **live WebSocket game state** with **parsed activity-feed lines** so you can track resources, bank, trades, dice, and victory-related info in one place.

## Features

- **Hands** — Per-seat resource totals from the in-game feed (gains, trades, discards, steals, starting cards), merged by player color; supports unknown card backs where the UI hides specifics.
- **Resource bank** — Snapshot from decoded wire frames.
- **Dice history** — Recent rolls from wire state.
- **Trades & production** — Mirror of trade wire / production-oriented payloads where supported.
- **Victory & awards** — Public VP and longest road / largest army from the wire, **plus** feed-derived bonuses when the log shows *Longest Road* / *Largest Army* with explicit `+N VP` (or default +2). The VP column is **wire + feed**, with a **guard** so LR/LA +VP from the feed is not added twice when the wire total already includes that bonus (`hasLongestRoad` / `hasLargestArmy` and merged `victoryPointsState`).
- **Development cards** & **pieces** — From wire when present.
- **Light / dark** UI toggle.
- **Export JSON** — Session + tracker snapshot from the side panel for debugging or external analysis.

## How it works

1. **Injected script** (`injected.js`) observes WebSocket traffic and forwards decoded JSON/MessagePack to the extension.
2. **Game log** (`game-log.js`) watches the virtualized activity feed and turns relevant rows into resource deltas and VP-award events.
3. **Background** merges everything into `colonistTrackerState` in `chrome.storage.session`; the **side panel** reads that state (no direct content-script → panel messaging).

## Install (unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → choose the `extension` folder inside this repo

Open a Colonist (or Hexs) game tab, then click the extension icon to open the side panel.

### Install from a release zip (no store)

If you publish **GitHub Releases** (or any download link), others can:

1. Download **`colonist-game-analyst-extension.zip`** (build it with `npm run pack-extension`, or attach the output to a release).
2. Unzip to a folder whose root contains `manifest.json`.
3. In Chrome: **chrome://extensions** → **Developer mode** → **Load unpacked** → select that folder.

That is a normal way many extensions reach users when the **Chrome Web Store developer signup** is not available in their country.

## Usage tips

- Keep the **game tab** focused enough that the feed and WebSocket stay active.
- After a new match, the tracker resets when the feed indicates a new game (e.g. “Happy settling”); you can also use **Clear all** in the panel.
- **Pause updates** freezes the UI for a stable snapshot.
- If VP in the panel disagrees slightly with the in-game scoreboard, check whether the **feed** has awarded LR/LA; base VP still comes from the wire unless you extend parsing further.

## Changelog & versioning

- **[CHANGELOG.md](CHANGELOG.md)** — human-readable release notes.
- **Canonical extension version:** `extension/manifest.json` → `version` (what Chrome shows after load).
- **npm `package.json` `version`** — kept **in sync** with the manifest for a single version string in the repo.

Release checklist: bump **`extension/manifest.json`** and **`package.json`** together, then append a dated section to **`CHANGELOG.md`**.

### Chrome Web Store (only where Google supports developer registration)

Google ties store signup to **supported countries / payment regions**. If yours is not listed (e.g. some users report this for **Bosnia and Herzegovina**), you **cannot** complete official publishing until Google expands eligibility—or you use a **separate legitimate publisher** in a supported region (legal/contract, not a fake address).

**Until then:** treat **[GitHub (or similar) + zip + Load unpacked](#install-from-a-release-zip-no-store)** as your real distribution path; the extension is still fully usable.

When your region **is** supported:

1. Host **[`docs/privacy-policy.html`](docs/privacy-policy.html)** at a public **HTTPS** URL; fill in the contact line.
2. Follow **[`docs/CHROME_WEB_STORE.md`](docs/CHROME_WEB_STORE.md)** for listing text, permission justifications, and screenshots.
3. Build the upload zip: **`npm run pack-extension`** → `colonist-game-analyst-extension.zip` in the project root.

## Development

```bash
npm test
```

## Releasing the extension

**Unpacked / friends:** The steps above are enough.

**Chrome Web Store (optional):**

1. **Version & notes** — Bump `extension/manifest.json` and root `package.json`; update **`CHANGELOG.md`**.
2. **Icons** — Add `icons/` in `manifest.json` (16, 48, 128) if not already present; the store expects them for a polished listing.
3. **ZIP** — Package **only** the `extension` folder (its root must contain `manifest.json`).
4. **Privacy practices** — Declare `storage` (session), `scripting`, `sidePanel`, `tabs`; state that analytics/game data stay **local** (no extension-operated backend in this design).
5. **Store listing** — Short description, 1–5 screenshots of the side panel, category (e.g. Games or Productivity).
6. **Policy** — Emphasize **read-only analysis** and fair play; align with [Colonist](https://colonist.io) terms of service.

See **[docs/CHROME_WEB_STORE.md](docs/CHROME_WEB_STORE.md)** for a full store checklist and copy-paste descriptions.

## Disclaimer

For **match tracking and personal analysis** only. Do not use it for automation, cheating, or anything that violates platform rules or fair play.

## License

[MIT](LICENSE)
