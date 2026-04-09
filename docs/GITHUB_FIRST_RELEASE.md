# First GitHub Release (no Chrome Web Store)

Extension version is **`extension/manifest.json`** → `version` (e.g. `0.5.37`). Release tags use the same number with a `v` prefix: **`v0.5.37`**.

## Option A — Push a tag (recommended)

After **[GitHub Actions](https://github.com/PavaoZornija1/colonist-game-analyst/actions)** is enabled on the repo and `.github/workflows/release.yml` is on `main`:

```bash
cd colonist-game-analyst
git checkout main
git pull
# optional: commit any pending changes first
git tag v0.5.37
git push origin v0.5.37
```

GitHub creates a **Release** for that tag, builds **`colonist-game-analyst-extension.zip`**, and attaches it. Release notes include the install line plus auto-generated commits.

To fix a bad release: delete the tag on GitHub and locally, then re-tag:

```bash
git tag -d v0.5.37
git push origin :refs/tags/v0.5.37
git tag v0.5.37
git push origin v0.5.37
```

(Or edit the release on the website and re-upload the zip manually.)

## Option B — Manual release in the browser

1. Run **`npm run pack-extension`** locally → `colonist-game-analyst-extension.zip`
2. Open **GitHub → Releases → Draft a new release**
3. **Choose tag:** create new tag `v0.5.37` targeting `main`
4. **Title:** e.g. `Colonist Game Analyst v0.5.37`
5. **Description** (copy-paste):

```markdown
**How to install:** Download **`colonist-game-analyst-extension.zip`** → unzip → Chrome **`chrome://extensions`** → turn on **Developer mode** → **Load unpacked** → pick the folder that contains **`manifest.json`**.

[Full README](https://github.com/PavaoZornija1/colonist-game-analyst/blob/main/README.md#install-from-a-release-zip-no-store)
```

6. Attach **`colonist-game-analyst-extension.zip`**
7. Publish release

## Next versions

Bump **`extension/manifest.json`** and **`package.json`**, update **`CHANGELOG.md`**, commit, then tag anew (`v0.5.38`, etc.) and push the tag.
