# Changelog

All notable changes to **Colonist Game Analyst** are tracked here. The **shipping version** for the Chrome extension is the `version` field in [`extension/manifest.json`](extension/manifest.json). The repo `package.json` `version` is kept aligned for developer reference.

## [0.5.39] - 2026-04-09

### Changed

- **Icons:** regenerate **`icon-16/48/128.png`** from **`extension/icons/image.png`** (1024² master).
- **`pack-extension` / release workflow:** exclude large source files **`icons/image.png`** and **`icons/icon.png`** from the zip (shipped icons only).

## [0.5.38] - 2026-04-09

### Changed

- **`manifest` icons:** top-level `icons` use **`icon-16.png` / `icon-48.png` / `icon-128.png`** (generated from `icons/icon.png`), matching `action.default_icon`.

## [0.5.37] - 2026-04-09

### Added

- Extension **icons** (16 / 48 / 128) in `extension/icons/`; `manifest` `icons` + `action.default_icon`.
- **Chrome Web Store** helper: [`docs/CHROME_WEB_STORE.md`](docs/CHROME_WEB_STORE.md) (listing copy, permissions text, zip instructions).
- Hostable **[`docs/privacy-policy.html`](docs/privacy-policy.html)** for the store privacy URL (add contact + publish over HTTPS).
- **`npm run pack-extension`** — zip the `extension` folder for upload.
- **GitHub Releases:** [`.github/workflows/release.yml`](.github/workflows/release.yml) attaches `colonist-game-analyst-extension.zip` when you push a `v*` tag; see [`docs/GITHUB_FIRST_RELEASE.md`](docs/GITHUB_FIRST_RELEASE.md).

## [0.5.36] - 2026-04-09

### Added

- `CHANGELOG.md` and release/version notes in the README (single source of truth: **manifest**).
- **VP double-count guard:** the Victory total column (`feedVpAwardsForDisplayColumn`) skips feed LR/LA +VP when the wire already reflects those bonuses (`hasLongestRoad` / `hasLargestArmy`, `victoryPointsPublic` vs merged `victoryPointsState`).
- Wire fields **`hasLongestRoad`** and **`hasLargestArmy`** read from mechanic state when the server sends them.

### Changed

- npm package version aligned with extension manifest for release discipline.

## [0.5.35] - 2026-04-09

### Fixed

- Merge **partial** `victoryPointsState` wire patches per player before summing, so city VP (and other keys) are not dropped when the server sends incremental diffs.

### Changed

- Quick insights: “scarcest in bank” only when min supply is below max (avoid noise when all piles are equal).

## [0.5.34] - 2026-04-09

### Added

- Activity feed parsing for **Longest Road** / **Largest Army** `received` / `lost` (+ optional `+N VP`), merged into Victory & awards (`game-log-vp`, `feedLongestRoadVp`, `feedLargestArmyVp`).

### Changed

- Victory table VP column: wire + feed; LR/LA cells show wire metric plus feed award when present.

---

Earlier history: see git log.
