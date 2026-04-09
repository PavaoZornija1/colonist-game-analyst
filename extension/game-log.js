/**
 * Parses Colonist in-game activity feed (virtualized DOM) into resource deltas.
 * Class names are CSS-module hashes; we match substrings like "feedMessage", "virtualScroller".
 * Isolated-world IIFE — no top-level const collisions with content.js.
 */
(function colonistAnalystGameLog() {
  "use strict";

  if (window.__colonistAnalystGameLogPatched) return;
  window.__colonistAnalystGameLogPatched = true;

  const MESSAGE_SOURCE = "colonist-game-analyst";

  const SNIPS = {
    built: "built a",
    bought: "bought",
    gaveBank: "gave bank",
    tookBank: "and took",
    tradedWith: " traded with: ",
    wantsGive: "wants to give",
    giveFor: " for ",
    stoleFrom: " from ",
  };

  let feedRootEl = null;
  let observer = null;
  /** @type {Set<string>} */
  const seenMessageKeys = new Set();
  /** @type {Map<string, string>} row data-index -> last seen fingerprint */
  const seenRowFingerprintByIndex = new Map();
  const SEEN_MAX = 800;
  let scanTimer = 0;
  let lastResetSentAt = 0;

  function findInShadowRoots(root, id) {
    try {
      if (!root) return null;
      if (typeof root.getElementById === "function") {
        const hit = root.getElementById(id);
        if (hit) return hit;
      }
      const all = root.querySelectorAll("*");
      for (const el of all) {
        if (el.shadowRoot) {
          const hit = findInShadowRoots(el.shadowRoot, id);
          if (hit) return hit;
        }
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  /** Colonist ~2025+: game feed lives under gameFeedsContainer → virtualScroller (CSS-module hashes). */
  function findVirtualFeedRoot() {
    const feeds = document.querySelector('[class*="gameFeedsContainer"]');
    if (feeds) {
      const sc = feeds.querySelector('[class*="virtualScroller"]');
      if (sc) return sc;
      const vc = feeds.querySelector('[class*="virtualContainer"]');
      if (vc) return vc;
    }
    const anchor = document.querySelector('[class*="feedMessage"]');
    if (anchor) {
      const sc = anchor.closest('[class*="virtualScroller"]');
      if (sc) return sc;
      const vc = anchor.closest('[class*="virtualContainer"]');
      if (vc) return vc;
    }
    const byScroller = document.querySelector('[class*="virtualScroller"]');
    if (byScroller) return byScroller;
    const feed = document.querySelector('[class*="feedMessage"]');
    if (feed) {
      return feed.parentElement;
    }
    const tryIds = ["game-log-text", "gameLogText", "game_log_text", "gamelog-text"];
    for (const id of tryIds) {
      const direct = document.getElementById(id);
      if (direct) return direct;
      const hit = findInShadowRoots(document.documentElement, id);
      if (hit) return hit;
    }
    return null;
  }

  function rememberKey(key) {
    seenMessageKeys.add(key);
    if (seenMessageKeys.size > SEEN_MAX) {
      const it = seenMessageKeys.values();
      for (let i = 0; i < 200 && seenMessageKeys.size > SEEN_MAX - 200; i++) {
        const n = it.next();
        if (n.done) break;
        seenMessageKeys.delete(n.value);
      }
    }
  }

  /** Fallback fingerprint when no row data-index is available. */
  function messageFingerprint(el) {
    const root = feedMessageRoot(el) || el;
    const t = (root.textContent || "").replace(/\s+/g, " ").trim().slice(0, 280);
    const imgs = [...root.querySelectorAll("img")]
      .map((i) => {
        const s = i.src || "";
        const seg = s.split("/").pop() || "";
        return seg.split("?")[0];
      })
      .join(",");
    return `${t}|${imgs}`;
  }

  function rowIndexKey(el) {
    const row = el.closest("[data-index]") || el;
    const idx = row && row.getAttribute ? row.getAttribute("data-index") : "";
    return idx && idx.trim() ? idx.trim() : "";
  }

  function cardsDelta() {
    return { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0, unknown: 0 };
  }

  function normalizePlayerNameToken(name) {
    return String(name || "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[:.,;!?]+$/g, "")
      .trim()
      .toLowerCase();
  }

  /** Same rules as `colonist-tracker.js` — must exist here (isolated IIFE, no module import). */
  function normalizeColonistChatHex(hex) {
    if (!hex || typeof hex !== "string") return "";
    const m = hex.trim().match(/^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/);
    if (!m) return "";
    let h = m[1].toLowerCase();
    if (h.length === 3)
      h = h
        .split("")
        .map((c) => c + c)
        .join("");
    return `#${h}`;
  }

  function extractLeadActor(part) {
    let bold =
      part.querySelector('span[style*="600"]') || part.querySelector('span[style*="font-weight"]');
    if (!bold) {
      for (const sp of part.querySelectorAll("span[style]")) {
        const st = sp.getAttribute("style") || "";
        if (/color:\s*#/i.test(st)) {
          bold = sp;
          break;
        }
      }
    }
    let name = (bold && bold.textContent ? bold.textContent : "").replace(/\s+/g, " ").trim();
    const style = (bold && bold.getAttribute("style")) || "";
    const m =
      style.match(/color:\s*#([0-9a-fA-F]{6})\b/i) || style.match(/color:\s*#([0-9a-fA-F]{3})\b/i);
    let hex = "";
    if (m) {
      let h = m[1].toLowerCase();
      if (h.length === 3) h = h.split("").map((c) => c + c).join("");
      hex = `#${h}`;
    }
    if (!name || !hex) {
      for (const sp of part.querySelectorAll('span[style*="color"]')) {
        const st = sp.getAttribute("style") || "";
        const mm =
          st.match(/color:\s*#([0-9a-fA-F]{6})\b/i) ||
          st.match(/color:\s*#([0-9a-fA-F]{3})\b/i);
        if (!mm) continue;
        const nm = (sp.textContent || "").replace(/\s+/g, " ").trim();
        if (!nm) continue;
        if (!hex) {
          let h = mm[1].toLowerCase();
          if (h.length === 3) h = h.split("").map((c) => c + c).join("");
          hex = `#${h}`;
        }
        if (!name) name = nm;
        if (name && hex) break;
      }
    }
    if (!name) {
      const text = (part.textContent || "").replace(/\s+/g, " ").trim();
      const first = text.split(/\s+/)[0];
      if (first) name = first;
    }
    /** Keep chat color for “You” so sniff / steals can resolve `logLocalPlayerColorHex`. */
    return { name, hex };
  }

  /** Feed row root (virtual list item). */
  function feedMessageRoot(el) {
    return el && el.closest ? el.closest('[class*="feedMessage"]') || el : el;
  }

  function hexForPlayerNameInPart(part, name) {
    const want = normalizePlayerNameToken(name);
    if (!want) return "";
    const spans = part.querySelectorAll('span[style*="color"]');
    for (const sp of spans) {
      const t = normalizePlayerNameToken(sp.textContent || "");
      if (t === want) {
        const st = sp.getAttribute("style") || "";
        const m = st.match(/color:\s*#([0-9a-fA-F]{6})\b/i) || st.match(/color:\s*#([0-9a-fA-F]{3})\b/i);
        if (m) {
          let h = m[1].toLowerCase();
          if (h.length === 3) h = h.split("").map((c) => c + c).join("");
          return `#${h}`;
        }
      }
    }
    return "";
  }

  /** Victim / trade partner names are sometimes plain text while colored spans omit punctuation. */
  function hexForPlayerNameLoose(partOrRoot, name) {
    const root = feedMessageRoot(partOrRoot) || partOrRoot;
    let h = hexForPlayerNameInPart(root, name);
    if (h) return h;
    const want = normalizePlayerNameToken(name);
    if (!want) return "";
    const head = want.split(/\s+/)[0];
    if (head && head !== want) {
      h = hexForPlayerNameInPart(root, head);
      if (h) return h;
    }
    const spans = root.querySelectorAll('span[style*="color"]');
    for (const sp of spans) {
      const t = normalizePlayerNameToken(sp.textContent || "");
      if (!t) continue;
      if (t === want || t.includes(want) || want.includes(t)) {
        const st = sp.getAttribute("style") || "";
        const m =
          st.match(/color:\s*#([0-9a-fA-F]{6})\b/i) || st.match(/color:\s*#([0-9a-fA-F]{3})\b/i);
        if (m) {
          let hx = m[1].toLowerCase();
          if (hx.length === 3) hx = hx.split("").map((c) => c + c).join("");
          return `#${hx}`;
        }
      }
    }
    return "";
  }

  function countHiddenResourceCardImgs(rootOrEl) {
    const root = feedMessageRoot(rootOrEl) || rootOrEl;
    let n = 0;
    for (const img of root.querySelectorAll("img")) {
      const src = img.src || "";
      const alt = ` ${img.alt || ""} `.toLowerCase();
      if (src.includes("card_rescardback") || alt.includes(" resource card ")) n += 1;
    }
    return n;
  }

  function deltaSum(cards) {
    if (!cards || typeof cards !== "object") return 0;
    return (
      Math.abs(Number(cards.lumber) || 0) +
      Math.abs(Number(cards.brick) || 0) +
      Math.abs(Number(cards.wool) || 0) +
      Math.abs(Number(cards.grain) || 0) +
      Math.abs(Number(cards.ore) || 0) +
      Math.abs(Number(cards.unknown) || 0)
    );
  }

  function lineText(part) {
    return (part?.textContent || "").replace(/\s+/g, " ").trim();
  }

  /** Append img-derived resource shorthand so feed lines are not blank after "got" / trade offers. */
  function resourceSummaryFromImgs(rootOrEl) {
    const root = feedMessageRoot(rootOrEl) || rootOrEl;
    const c = cardsDelta();
    addFromImgsFeedRow(root, 1, c);
    if (deltaSum(c) === 0) {
      addFromHtmlFragments((root.innerHTML || "").split("<img"), 1, c);
    }
    if (deltaSum(c) === 0) {
      addFromInlineAlts(root.innerHTML || "", 1, c);
    }
    if (deltaSum(c) === 0) return "";
    return resourcesToXOfferPhrase(c);
  }

  /** Dice faces from resource icons, e.g. alt="dice_1" → 1+2 (3). */
  function diceRollSummaryFromImgs(rootOrEl) {
    const root = feedMessageRoot(rootOrEl) || rootOrEl;
    const faces = [];
    for (const img of root.querySelectorAll("img")) {
      const raw = String(img.getAttribute("alt") || img.alt || "").trim();
      if (!raw) continue;
      const compact = raw.replace(/\s+/g, "");
      let m = /^dice_([1-6])$/i.exec(compact);
      if (!m) m = /^dice([1-6])$/i.exec(compact);
      if (m) {
        faces.push(Number(m[1]));
        continue;
      }
      const m2 = /^dice ([1-6])$/i.exec(raw);
      if (m2) faces.push(Number(m2[1]));
    }
    if (faces.length === 0) return "";
    const total = faces.reduce((a, b) => a + b, 0);
    if (faces.length === 1) return String(total);
    return `${faces.join("+")} (${total})`;
  }

  /** Map tile / terrain labels to log wording (grain not wheat). */
  function terrainWordForLog(rawAlt, srcHint) {
    const alt = String(rawAlt || "").trim().toLowerCase();
    const src = String(srcHint || "").toLowerCase();
    let w = "";
    const tileM = /^([a-z]+)\s+tile$/i.exec(alt);
    if (tileM) w = tileM[1].toLowerCase();
    else if (alt.includes("desert")) w = "desert";
    else if (/\bprob_\d/i.test(alt)) w = "";
    else if (/tile_(lumber|brick|wool|wheat|grain|ore)/.test(src))
      w = (src.match(/tile_(lumber|brick|wool|wheat|grain|ore)/) || [])[1] || "";
    if (w === "wheat") return "grain";
    if (w === "wood") return "lumber";
    return w;
  }

  /** Robber placement: prob_N chit + terrain tile icons (alt / src). */
  function robberMoveSummaryFromPart(rootOrEl) {
    const root = feedMessageRoot(rootOrEl) || rootOrEl;
    let pip = "";
    const terrains = [];
    for (const img of root.querySelectorAll("img")) {
      const raw = String(img.getAttribute("alt") || img.alt || "").trim();
      const src = imgEffectiveSrc(img);
      if (raw && /robber/i.test(raw)) continue;
      if (src.includes("icon_robber") || /\/icon_robber/i.test(src)) continue;

      const compact = raw.replace(/\s+/g, "");
      const pm =
        /^prob_(\d+)$/i.exec(compact) ||
        /\/prob_(\d+)\./i.exec(src) ||
        /prob_(\d+)/i.exec(src);
      if (pm) {
        pip = pm[1];
        continue;
      }
      const tw = terrainWordForLog(raw, src);
      if (tw) terrains.push(tw);
    }
    const uniq = [...new Set(terrains)].filter(Boolean);
    const terrainStr = uniq.join(", ");
    if (pip && terrainStr) return `chip ${pip} on ${terrainStr} hex`;
    if (pip) return `number chip ${pip}`;
    return terrainStr ? `${terrainStr} hex` : "";
  }

  /** Dev / progress cards after "used" (Knight in tooltip, etc.). */
  function usedPlaySummaryFromRoot(rootOrEl) {
    const root = feedMessageRoot(rootOrEl) || rootOrEl;
    for (const img of root.querySelectorAll("img")) {
      const src = imgEffectiveSrc(img);
      const raw = String(img.getAttribute("alt") || img.alt || "").trim();
      const r = raw.toLowerCase();
      if (src.includes("card_knight") || r === "knight") return "Knight";
      if (src.includes("year_of_plenty") || r.includes("year of plenty")) return "Year of Plenty";
      if (src.includes("monopoly") || r.includes("monopoly")) return "Monopoly";
      if (src.includes("road_building") || src.includes("card_roadbuilding") || r.includes("road building"))
        return "Road Building";
    }
    return "";
  }

  function resourcesToXOfferPhrase(c) {
    const bits = [];
    if (c.lumber) bits.push(`x${c.lumber} lumber`);
    if (c.brick) bits.push(`x${c.brick} brick`);
    if (c.wool) bits.push(`x${c.wool} wool`);
    if (c.grain) bits.push(`x${c.grain} grain`);
    if (c.ore) bits.push(`x${c.ore} ore`);
    if (c.unknown) bits.push(`x${c.unknown} unknown`);
    return bits.join(", ");
  }

  /** Purchase line: dev card back / alt text → “Development Card”, etc. */
  function boughtItemLabelFromRoot(rootOrEl) {
    const root = feedMessageRoot(rootOrEl) || rootOrEl;
    for (const img of root.querySelectorAll("img")) {
      const src = imgEffectiveSrc(img);
      const raw = String(img.getAttribute("alt") || img.alt || "").trim();
      const rl = raw.toLowerCase();
      if (
        src.includes("card_devcardback") ||
        src.includes("devcardback") ||
        /development\s*card/i.test(raw) ||
        (src.includes("devcard") && !src.includes("knight"))
      )
        return "Development Card";
      if (src.includes("card_knight") || rl === "knight") return "Knight";
    }
    return "";
  }

  /** "Name wants to give [A] for [B]" — separate HTML segments so we do not mix offer vs ask. */
  function tradeOfferLineFromRoot(rootOrEl) {
    const root = feedMessageRoot(rootOrEl) || rootOrEl;
    const html = root.innerHTML || "";
    const hLower = html.toLowerCase();
    const wi = hLower.indexOf(SNIPS.wantsGive);
    if (wi < 0) return "";
    const rel = hLower.slice(wi);
    const forM = /\s+for\s+/i.exec(rel);
    if (!forM) return "";
    const fi = wi + forM.index;
    const givePart = html.slice(wi, fi).split(/<img/i);
    const forPart = html.slice(fi).split(/<img/i);
    const gave = cardsDelta();
    const forg = cardsDelta();
    addFromHtmlFragments(givePart, 1, gave);
    addFromHtmlFragments(forPart, 1, forg);
    if (deltaSum(gave) === 0 && deltaSum(forg) === 0) {
      addFromInlineAlts(html.slice(wi, fi), 1, gave);
      addFromInlineAlts(html.slice(fi), 1, forg);
    }
    if (deltaSum(gave) === 0 && deltaSum(forg) === 0) {
      mergeCardsFromMarkupChunk(html.slice(wi, fi), gave);
      mergeCardsFromMarkupChunk(html.slice(fi), forg);
    }
    const g = resourcesToXOfferPhrase(gave);
    const f = resourcesToXOfferPhrase(forg);
    if (!g || !f) return "";
    const part = root.querySelector('[class*="messagePart"]') || root;
    const actor = extractLeadActor(part);
    const name = ((actor && actor.name) || "Player").trim() || "Player";
    return `${name} wants to give ${g} for ${f}`.replace(/\s+/g, " ").trim();
  }

  function feedDisplayMessage(rootOrEl) {
    const root = feedMessageRoot(rootOrEl) || rootOrEl;
    const base = lineText(root);
    if (!base) return base;
    const lower = base.toLowerCase();
    const isPlayerTradeLine =
      lower.includes(" gave ") &&
      lower.includes(" and got ") &&
      lower.includes(" from ");

    if (lower.includes(SNIPS.wantsGive) && /\bfor\b/i.test(lower)) {
      const offer = tradeOfferLineFromRoot(root);
      if (offer) return offer;
      /** Avoid misleading “— res×” appended from `resourceSummaryFromImgs` when offer parse fails. */
      return base;
    }

    if (/\b used\b/i.test(lower)) {
      const play = usedPlaySummaryFromRoot(root);
      if (play && !lower.includes(play.toLowerCase()))
        return `${base} — ${play}`.replace(/\s+/g, " ").trim();
    }

    if (/\brolled\b/.test(lower)) {
      const diceStr = diceRollSummaryFromImgs(root);
      if (diceStr) return `${base} — ${diceStr}`.replace(/\s+/g, " ").trim();
    }

    if (lower.includes("robber") && lower.includes("moved")) {
      const rob = robberMoveSummaryFromPart(root);
      if (rob) return `${base.replace(/\s+to\s*$/i, "").trim()} — ${rob}`.replace(/\s+/g, " ").trim();
    }

    if (lower.includes(SNIPS.bought)) {
      const item = boughtItemLabelFromRoot(root);
      if (item && !lower.includes(item.toLowerCase()))
        return `${base} ${item}`.replace(/\s+/g, " ").trim();
    }

    const wantsImgSummary =
      !isPlayerTradeLine &&
      (lower.includes("wants to give") ||
        /\bgot\b/i.test(lower) ||
        /\breceived\b/i.test(lower) ||
        /\bstole\b/i.test(lower) ||
        lower.includes("starting resource") ||
        lower.includes("gave bank") ||
        lower.includes("discarded") ||
        lower.includes(" traded with: "));
    if (!wantsImgSummary) return base;
    const extra = resourceSummaryFromImgs(root);
    if (!extra) return base;
    return `${base} ${extra}`.replace(/\s+/g, " ").trim();
  }

  /** Same string as `sendFeedLine(feedDisplayMessage(el))` — required for pairing `game-log` ↔ line in the sidepanel. */
  function feedHandMessage(rootOrEl) {
    return feedDisplayMessage(rootOrEl);
  }

  function sendHand(detail) {
    const cards = detail.cards;
    if (!cards || typeof cards !== "object") return;
    if (deltaSum(cards) === 0) return;
    const hasPlayer =
      typeof detail.player === "string" && detail.player.trim().length > 0;
    if (!detail.colorHex && !detail.targetYou && !hasPlayer) return;
    const payload = {
      source: MESSAGE_SOURCE,
      t: Date.now(),
      kind: "game-log",
      detail: {
        cards,
        ...(detail.colorHex ? { colorHex: detail.colorHex } : {}),
        ...(detail.targetYou ? { targetYou: true } : {}),
        ...(typeof detail.player === "string" && detail.player.trim()
          ? { player: detail.player.trim() }
          : {}),
        ...(typeof detail.message === "string" && detail.message.trim()
          ? { message: detail.message.trim() }
          : {}),
        ...(detail.setLocalDisplayName ? { setLocalDisplayName: true } : {}),
      },
    };
    try {
      if (!chrome.runtime?.id) return;
      chrome.runtime
        .sendMessage({ type: "ANALYST_PAGE_EVENT", payload })
        .catch((err) => {
          const msg = err?.message || String(err);
          if (msg.includes("Extension context invalidated")) return;
          console.warn("[Colonist analyst] game-log sendMessage failed:", msg);
        });
    } catch (e) {
      const msg = e?.message || String(e);
      if (msg.includes("Extension context invalidated")) return;
      console.warn("[Colonist analyst] game-log sendMessage failed:", msg);
    }
  }

  function sendFeedLine(message) {
    const text = String(message || "").trim();
    if (!text) return;
    const payload = {
      source: MESSAGE_SOURCE,
      t: Date.now(),
      kind: "game-log-line",
      detail: { message: text },
    };
    try {
      if (!chrome.runtime?.id) return;
      chrome.runtime.sendMessage({ type: "ANALYST_PAGE_EVENT", payload }).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  function sendMatchResetMeta() {
    const payload = {
      source: MESSAGE_SOURCE,
      t: Date.now(),
      kind: "game-log-meta",
      detail: { resetMatch: true },
    };
    try {
      if (!chrome.runtime?.id) return;
      chrome.runtime.sendMessage({ type: "ANALYST_PAGE_EVENT", payload }).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  /**
   * Longest Road / Largest Army (+VP) from activity feed — wire `victoryPointsPublic` is often incomplete.
   */
  function sendFeedAward(detail) {
    if (!detail || typeof detail !== "object") return;
    const hasPlayer =
      typeof detail.player === "string" && detail.player.trim().length > 0;
    if (!detail.colorHex && !detail.targetYou && !hasPlayer) return;
    const d = {
      ...(detail.colorHex ? { colorHex: detail.colorHex } : {}),
      ...(detail.targetYou ? { targetYou: true } : {}),
      ...(hasPlayer ? { player: detail.player.trim() } : {}),
      ...(typeof detail.message === "string" && detail.message.trim()
        ? { message: detail.message.trim() }
        : {}),
      ...(detail.setLocalDisplayName ? { setLocalDisplayName: true } : {}),
    };
    if (detail.longestRoadVp !== undefined) d.longestRoadVp = detail.longestRoadVp;
    if (detail.largestArmyVp !== undefined) d.largestArmyVp = detail.largestArmyVp;
    if (detail.extraVp !== undefined) d.extraVp = detail.extraVp;
    const payload = {
      source: MESSAGE_SOURCE,
      t: Date.now(),
      kind: "game-log-vp",
      detail: d,
    };
    try {
      if (!chrome.runtime?.id) return;
      chrome.runtime
        .sendMessage({ type: "ANALYST_PAGE_EVENT", payload })
        .catch((err) => {
          const msg = err?.message || String(err);
          if (msg.includes("Extension context invalidated")) return;
          console.warn("[Colonist analyst] game-log-vp sendMessage failed:", msg);
        });
    } catch (e) {
      const msg = e?.message || String(e);
      if (msg.includes("Extension context invalidated")) return;
      console.warn("[Colonist analyst] game-log-vp sendMessage failed:", msg);
    }
  }

  /**
   * Feed lines like “PavaoZ received Longest Road … (+2 VPs)” / “lost Largest Army”.
   */
  function parseFeedAwards(el) {
    const root = feedMessageRoot(el) || el;
    const part = root.querySelector('[class*="messagePart"]') || root;
    const text = (part.textContent || "").replace(/\s+/g, " ").trim();
    const lower = text.toLowerCase();
    const isLR = /\blongest\s+road\b/i.test(lower);
    const isLA = /\blargest\s+army\b/i.test(lower);
    if (!isLR && !isLA) return;

    const isLost = /\blost\b/i.test(lower);
    const isReceived = /\breceived\b/i.test(lower);
    if (!isLost && !isReceived) return;

    const actor = extractLeadActor(part);
    const dest = actorDestination(el, actor);
    if (!dest) return;

    let vpBonus = 2;
    const vm = text.match(/\(\s*\+(\d+)\s*vps?\s*\)/i);
    if (vm) {
      const n = Number(vm[1]);
      if (Number.isFinite(n) && n > 0) vpBonus = n;
    }

    const msg = feedHandMessage(root);
    if (isLR) {
      if (isLost) sendFeedAward({ ...dest, longestRoadVp: 0, message: msg });
      else if (isReceived) sendFeedAward({ ...dest, longestRoadVp: vpBonus, message: msg });
    }
    if (isLA) {
      if (isLost) sendFeedAward({ ...dest, largestArmyVp: 0, message: msg });
      else if (isReceived) sendFeedAward({ ...dest, largestArmyVp: vpBonus, message: msg });
    }
  }

  function isMatchStartLine(text) {
    const s = String(text || "").toLowerCase();
    return s.includes("happy settling");
  }

  function imgEffectiveSrc(img) {
    const raw =
      img.currentSrc ||
      img.src ||
      img.getAttribute("src") ||
      img.getAttribute("data-src") ||
      img.getAttribute("data-lazy-src") ||
      "";
    return String(raw).toLowerCase();
  }

  /** Colonist uses `alt="Lumber"`, `alt="Wool"`, etc. — normalize for comparisons. */
  function normalizeResourceLabelToken(raw) {
    let s = String(raw ?? "").trim();
    try {
      if (typeof s.normalize === "function") s = s.normalize("NFKC");
    } catch {
      /* ignore */
    }
    return s.toLowerCase().replace(/\s+/g, " ");
  }

  function imgAltToken(img) {
    const a =
      (img && (img.alt ?? img.getAttribute?.("alt") ?? img.getAttribute?.("ALT"))) || "";
    return normalizeResourceLabelToken(a);
  }

  function isNonResourceIconLabel(tokNorm) {
    return /resource\s*card|cardback|rescardback|dice|settlement|road|robber|longest|ship|city|knight|monopoly|year|\bdev\b/i.test(
      tokNorm,
    );
  }

  /** Avatars, dice, map tiles, robber, dev plays — not production “got” resource cards. */
  function skipImgForResourceCardCounting(img) {
    const src = imgEffectiveSrc(img);
    const altRaw = String(img.getAttribute("alt") || img.alt || "").trim();
    const alt = altRaw.toLowerCase().replace(/\s+/g, " ");
    if (src.includes("icon_player_loggedin")) return true;
    if (src.includes("icon_bot") || src.includes("icon_player")) return true;
    if (src.includes("dice_") || src.includes("/dice")) return true;
    if (src.includes("prob_") || /^prob_[0-9]+$/i.test(altRaw.replace(/\s+/g, ""))) return true;
    if (src.includes("icon_robber") || (src.includes("robber") && !src.includes("card"))) return true;
    if (/tile_(lumber|brick|wool|wheat|grain|ore|desert)/.test(src)) return true;
    if (/\b(lumber|brick|wool|wheat|grain|ore|desert)\s+tile\b/i.test(altRaw)) return true;
    if (src.includes("settlement") && !src.includes("card")) return true;
    if (src.includes("city") && !src.includes("card") && !src.includes("dev")) return true;
    if (
      (src.includes("road") || /\broad\b/.test(alt)) &&
      !src.includes("card_road") &&
      !src.includes("cardroad")
    )
      return true;
    if (src.includes("card_knight") || /^knight$/i.test(altRaw.trim())) return true;
    if (src.includes("devcard") || src.includes("dev_card") || src.includes("card_dev")) return true;
    if (src.includes("longest") || src.includes("largest")) return true;
    if (src.includes("ship") && !src.includes("card")) return true;
    return false;
  }

  function addFromImgsFeedRow(rootEl, sign, into) {
    const root = feedMessageRoot(rootEl) || rootEl;
    addFromImgs(root, sign, into, skipImgForResourceCardCounting);
  }

  /** Map normalized alt/title text (any casing) to card counts. */
  function applyResourceLabelTextToCards(labelRaw, sign, into) {
    const t = normalizeResourceLabelToken(labelRaw);
    if (!t || isNonResourceIconLabel(t)) return;
    if (/\b(lumber|wood)\b/.test(t)) into.lumber += sign;
    else if (/\bbrick\b/.test(t)) into.brick += sign;
    else if (/\bwool\b/.test(t)) into.wool += sign;
    else if (/\b(grain|wheat)\b/.test(t)) into.grain += sign;
    else if (/\bore\b/.test(t)) into.ore += sign;
  }

  function addFromImgs(el, sign, into, skipImgFn) {
    for (const img of el.querySelectorAll("img")) {
      if (typeof skipImgFn === "function" && skipImgFn(img)) continue;
      const src = imgEffectiveSrc(img);
      const altTok = imgAltToken(img);
      const alt = ` ${altTok} `;
      if (src.includes("card_rescardback") || alt.includes(" resource card ")) continue;
      if (
        src.includes("card_lumber") ||
        src.includes("lumber") ||
        src.includes("wood") ||
        alt.includes(" lumber ") ||
        alt.includes(" wood ") ||
        /\b(lumber|wood)\b/.test(altTok)
      )
        into.lumber += sign;
      else if (
        src.includes("card_brick") ||
        src.includes("brick") ||
        alt.includes(" brick ") ||
        /\bbrick\b/.test(altTok)
      )
        into.brick += sign;
      else if (
        src.includes("card_wool") ||
        src.includes("wool") ||
        alt.includes(" wool ") ||
        /\bwool\b/.test(altTok)
      )
        into.wool += sign;
      else if (
        src.includes("card_grain") ||
        src.includes("card_wheat") ||
        src.includes("grain") ||
        src.includes("wheat") ||
        alt.includes(" grain ") ||
        alt.includes(" wheat ") ||
        /\b(grain|wheat)\b/.test(altTok)
      )
        into.grain += sign;
      else if (
        src.includes("card_ore") ||
        alt.includes(" ore ") ||
        /\bore\b/.test(altTok)
      )
        into.ore += sign;
    }
  }

  function addFromHtmlFragments(parts, sign, into) {
    for (const frag of parts) {
      const f = String(frag || "").toLowerCase();
      if (f.includes("card_rescardback") || f.includes("alt=\"resource card\"")) into.unknown += sign;
      else if (
        f.includes("card_wool") ||
        f.includes("alt=\"wool\"") ||
        f.includes("alt='wool'")
      )
        into.wool += sign;
      else if (
        f.includes("card_lumber") ||
        f.includes("alt=\"lumber\"") ||
        f.includes("alt='lumber'")
      )
        into.lumber += sign;
      else if (
        f.includes("card_brick") ||
        f.includes("alt=\"brick\"") ||
        f.includes("alt='brick'")
      )
        into.brick += sign;
      else if (
        f.includes("card_grain") ||
        f.includes("card_wheat") ||
        f.includes("alt=\"grain\"") ||
        f.includes("alt=\"wheat\"") ||
        f.includes("alt='grain'") ||
        f.includes("alt='wheat'")
      )
        into.grain += sign;
      else if (
        f.includes("card_ore") ||
        f.includes("alt=\"ore\"") ||
        f.includes("alt='ore'")
      )
        into.ore += sign;
    }
  }

  /**
   * Scan raw HTML for alt=… (any attribute casing: ALT="Lumber", alt='WOOL').
   * `i` flag so `alt` matches `ALT`. (Title omitted to avoid double-count with alt.)
   */
  function addFromInlineAlts(html, sign, into) {
    const htmlStr = String(html || "");
    const re = /\balt\s*=\s*["']([^"']*)["']/gi;
    let m;
    while ((m = re.exec(htmlStr)) !== null) {
      applyResourceLabelTextToCards(m[1], sign, into);
    }
  }

  function rowFromLoggedInUser(el) {
    try {
      return !!el.querySelector('img[src*="icon_player_loggedin"]');
    } catch {
      return false;
    }
  }

  function sendLocalMeta(displayName, colorHex) {
    if (!displayName) return;
    const payload = {
      source: MESSAGE_SOURCE,
      t: Date.now(),
      kind: "game-log-meta",
      detail: { player: displayName, setLocalDisplayName: true, colorHex: colorHex || "" },
    };
    try {
      if (!chrome.runtime?.id) return;
      chrome.runtime.sendMessage({ type: "ANALYST_PAGE_EVENT", payload }).catch((err) => {
        const msg = err?.message || String(err);
        if (msg.includes("Extension context invalidated")) return;
        console.warn("[Colonist analyst] game-log-meta sendMessage failed:", msg);
      });
    } catch (e) {
      const msg = e?.message || String(e);
      if (msg.includes("Extension context invalidated")) return;
      console.warn("[Colonist analyst] game-log-meta sendMessage failed:", msg);
    }
  }

  function sniffLocalPlayerFromRow(el) {
    if (!rowFromLoggedInUser(el)) return;
    const part = el.querySelector('[class*="messagePart"]') || el;
    const raw = lineText(part);
    const lead = raw.trimStart().toLowerCase();
    /**
     * Colonist shows the logged-in avatar on many feed rows, including other players’ lines.
     * We must only sniff identity from messages about *you*, not “Jessie got …”.
     */
    if (!lead.startsWith("you")) return;
    if (/^you\s+stole\b/i.test(lead)) return;
    const safeYouVerb =
      /^you\s+(got|received|starting|discarded|built|bought|used|moved|placed)\b/i.test(
        lead,
      );
    if (!safeYouVerb) return;
    const actor = extractLeadActor(part);
    const name = (actor.name || "").trim();
    if (!name || normalizePlayerNameToken(name) === "you") return;
    sendLocalMeta(name, actor.hex || "");
  }

  function actorDestination(el, actor) {
    const colorHex = normalizeColonistChatHex(actor?.hex);
    const isLocalRow = rowFromLoggedInUser(el);
    const player = typeof actor?.name === "string" ? actor.name.trim() : "";
    const nameNorm = normalizePlayerNameToken(player);
    /** Feed sometimes says “You” with no inline color + no logged-in avatar on that row. */
    const inferredYou = nameNorm === "you";
    if (colorHex) {
      return {
        colorHex,
        ...(player ? { player } : {}),
        ...(isLocalRow ? { setLocalDisplayName: true } : {}),
      };
    }
    if (!isLocalRow && !inferredYou) return null;
    return {
      targetYou: true,
      ...(player ? { player } : {}),
      setLocalDisplayName: true,
    };
  }

  /**
   * "A gave [cards] and got [cards] from B" — bank trades may use "bank" (no hex); player trades need B’s colored span.
   */
  /** "Name received starting resources [cards]" (initial deal in feed). */
  function parseReceivedStartingResources(el) {
    const root = feedMessageRoot(el) || el;
    const part = root.querySelector('[class*="messagePart"]') || root;
    const lower = (part.textContent || "").toLowerCase();
    if (!lower.includes("starting resource")) return;
    const actor = extractLeadActor(part);
    const dest = actorDestination(el, actor);
    if (!dest) return;
    const c = cardsDelta();
    addFromImgsFeedRow(root, 1, c);
    if (deltaSum(c) === 0) {
      addFromHtmlFragments((root.innerHTML || "").split("<img"), 1, c);
    }
    if (deltaSum(c) === 0) {
      addFromInlineAlts(root.innerHTML || "", 1, c);
    }
    if (deltaSum(c) === 0) return;
    sendHand({ ...dest, cards: c, message: feedHandMessage(root) });
  }

  function mergeCardsFromMarkupChunk(markup, into) {
    const s = String(markup || "");
    if (!s.trim()) return;
    const before = deltaSum(into);
    try {
      const w = document.createElement("div");
      w.innerHTML = s;
      addFromImgs(w, 1, into);
    } catch {
      /* ignore */
    }
    if (deltaSum(into) === before) {
      addFromHtmlFragments(s.split(/<img/i), 1, into);
      addFromInlineAlts(s, 1, into);
    }
  }

  function parseGaveAndGotFromPlayer(el) {
    const root = feedMessageRoot(el) || el;
    const part = root.querySelector('[class*="messagePart"]') || root;
    const logMsg = feedHandMessage(root);
    const text = part.textContent || "";
    const lower = text.toLowerCase();
    const gaveI = lower.indexOf(" gave ");
    const andGotI = lower.indexOf(" and got ", gaveI + 1);
    const fromI = lower.indexOf(" from ", andGotI + 1);
    if (gaveI < 0 || andGotI < 0 || fromI < 0) return;

    const html = part.innerHTML;
    const hi = html.toLowerCase();
    const gaveHi = hi.indexOf(" gave ");
    const andGotHi = hi.indexOf(" and got ", gaveHi + 1);
    const fromHi = hi.indexOf(" from ", andGotHi + 1);
    if (gaveHi < 0 || andGotHi < 0 || fromHi < 0) return;

    const FROM_SNIP = " from ";
    const gaveHtml = html.slice(gaveHi + " gave ".length, andGotHi);
    const gotHtml = html.slice(andGotHi + " and got ".length, fromHi);

    const actor = extractLeadActor(part);
    const actorDest = actorDestination(el, actor);
    if (!actorDest) return;

    const gaveC = cardsDelta();
    mergeCardsFromMarkupChunk(gaveHtml, gaveC);
    const gotC = cardsDelta();
    mergeCardsFromMarkupChunk(gotHtml, gotC);

    /**
     * Colonist often renders “X gave and got from Y” with icons only after Y’s name
     * (no cards between “gave” / “and got” / “from”). Split trailing imgs: first half = gave, second half = got.
     */
    if (deltaSum(gaveC) === 0 && deltaSum(gotC) === 0) {
      const tailRaw = html.slice(fromHi + FROM_SNIP.length);
      const tailParts = tailRaw.split(/<img\b/i);
      if (tailParts.length > 2) {
        const imgBlobs = tailParts.slice(1).map((frag) => "<img" + frag);
        const n = imgBlobs.length;
        if (n >= 2) {
          const half = Math.floor(n / 2);
          if (half > 0 && n - half > 0) {
            mergeCardsFromMarkupChunk(imgBlobs.slice(0, half).join(""), gaveC);
            mergeCardsFromMarkupChunk(imgBlobs.slice(half).join(""), gotC);
          }
        }
      }
    }

    let partnerName = text.slice(fromI + FROM_SNIP.length).trim();
    const partnerHead = partnerName.split(/\s+/)[0] || partnerName;
    partnerName = partnerHead;
    const partnerNorm = normalizePlayerNameToken(partnerName);
    const partnerHex =
      partnerNorm === "bank" || partnerNorm.startsWith("bank ")
        ? ""
        : hexForPlayerNameLoose(root, partnerName);

    function sendToPartner(cards) {
      for (const k of Object.keys(cards)) {
        const n = cards[k];
        if (!n) continue;
        if (partnerNorm === "you") {
          sendHand({ targetYou: true, cards: { [k]: n }, message: logMsg });
        } else if (partnerHex) {
          sendHand({ colorHex: partnerHex, cards: { [k]: n }, message: logMsg });
        }
      }
    }

    for (const k of Object.keys(gaveC)) {
      if (!gaveC[k]) continue;
      sendHand({ ...actorDest, cards: { [k]: -gaveC[k] }, message: logMsg });
      sendToPartner({ [k]: gaveC[k] });
    }
    for (const k of Object.keys(gotC)) {
      if (!gotC[k]) continue;
      sendHand({ ...actorDest, cards: { [k]: gotC[k] }, message: logMsg });
      sendToPartner({ [k]: -gotC[k] });
    }
  }

  function parseGot(el) {
    const root = feedMessageRoot(el) || el;
    const part = root.querySelector('[class*="messagePart"]') || root;
    const text = part.textContent || "";
    const lower = text.toLowerCase();
    if (lower.includes(" gave ") && lower.includes(" and got ") && lower.includes(" from ")) return;
    if (lower.includes("starting resource")) return;
    if (!/\bgot\b/i.test(lower) && !/\breceived\b/i.test(lower)) return;
    const actor = extractLeadActor(part);
    const dest = actorDestination(el, actor);
    if (!dest) return;
    const c = cardsDelta();
    addFromImgsFeedRow(root, 1, c);
    if (deltaSum(c) === 0) {
      addFromHtmlFragments((root.innerHTML || "").split("<img"), 1, c);
    }
    if (deltaSum(c) === 0) {
      addFromInlineAlts(root.innerHTML || "", 1, c);
    }
    if (deltaSum(c) === 0) return;
    sendHand({ ...dest, cards: c, message: feedHandMessage(root) });
  }

  function parseDiscard(el) {
    const root = feedMessageRoot(el) || el;
    const part = root.querySelector('[class*="messagePart"]') || root;
    const raw = part.textContent || "";
    const lower = raw.toLowerCase();
    const i = lower.indexOf("discarded");
    if (i < 0) return;
    /** Ignore “… to discard …” bot lines — require “Name discarded”. */
    const trimmedDiscard = raw.trim().replace(/\s+/g, " ");
    if (!/\S+\s+discarded\b/i.test(trimmedDiscard)) return;
    const actor = extractLeadActor(part);
    let dest = actorDestination(el, actor);
    if (!dest) {
      const m = /^(.+?)\s+discarded\b/i.exec(trimmedDiscard);
      if (m) {
        const guess = m[1].trim();
        const gn = normalizePlayerNameToken(guess);
        if (gn === "you") dest = { targetYou: true };
        else {
          const hx = hexForPlayerNameLoose(root, guess);
          if (hx)
            dest = {
              colorHex: hx,
              player: guess.split(/\s+/)[0] || guess,
            };
        }
      }
    }
    if (!dest) return;
    const c = cardsDelta();
    addFromImgsFeedRow(root, -1, c);
    if (deltaSum(c) === 0) {
      addFromHtmlFragments((root.innerHTML || "").split("<img"), -1, c);
    }
    if (deltaSum(c) === 0) {
      addFromInlineAlts(root.innerHTML || "", -1, c);
    }
    if (deltaSum(c) === 0) return;
    sendHand({ ...dest, cards: c, message: feedHandMessage(root) });
  }

  function parseBuilt(el) {
    const root = feedMessageRoot(el) || el;
    const part = root.querySelector('[class*="messagePart"]') || root;
    const lower = (part.textContent || "").toLowerCase();
    const isPlaced =
      lower.includes("placed a ") || lower.includes("placed an ");
    const isBuilt =
      lower.includes("built a ") || lower.includes("built an ");
    if (!isPlaced && !isBuilt) return;
    /**
     * Colonist uses “placed” for setup (free) and “built” for main game (paid).
     * Do not deduct cards for “placed …”.
     */
    if (isPlaced && !isBuilt) return;
    const actor = extractLeadActor(part);
    const dest = actorDestination(el, actor);
    if (!dest) return;
    const c = cardsDelta();
    /** Order matters: avoid matching generic “road” in odd filenames before settlement/city. */
    let kind = "";
    for (const img of part.querySelectorAll("img")) {
      const src = (img.src || "").toLowerCase();
      if (src.includes("settlement")) {
        kind = "settlement";
        break;
      }
      if (src.includes("city") && !src.includes("settlement")) {
        kind = "city";
        break;
      }
      if (src.includes("road") && !src.includes("road_build") && !src.includes("longest")) {
        kind = "road";
        break;
      }
    }
    if (kind === "road") {
      c.lumber -= 1;
      c.brick -= 1;
    } else if (kind === "settlement") {
      c.lumber -= 1;
      c.brick -= 1;
      c.wool -= 1;
      c.grain -= 1;
    } else if (kind === "city") {
      c.grain -= 2;
      c.ore -= 3;
    }
    if (deltaSum(c) === 0) return;
    sendHand({ ...dest, cards: c, message: feedHandMessage(root) });
  }

  function parseBought(el) {
    const root = feedMessageRoot(el) || el;
    const part = root.querySelector('[class*="messagePart"]') || root;
    const text = (part.textContent || "").toLowerCase();
    if (!text.includes(SNIPS.bought)) return;
    const actor = extractLeadActor(part);
    const dest = actorDestination(el, actor);
    if (!dest) return;
    let dev = false;
    for (const img of part.querySelectorAll("img")) {
      const s = (img.src || "").toLowerCase();
      const alt = ` ${(img.alt || "").toLowerCase()} `;
      if (
        s.includes("devcard") ||
        s.includes("dev_card") ||
        s.includes("card_dev") ||
        s.includes("devcardback") ||
        s.includes("card_devcardback")
      ) {
        dev = true;
        break;
      }
      if (alt.includes(" development card ") || alt.includes(" dev card ")) {
        dev = true;
        break;
      }
    }
    // Some Colonist variants render this line without a dev-card image.
    if (!dev) {
      if (
        text.includes("development card") ||
        text.includes("dev card") ||
        text.includes("bought a card")
      ) {
        dev = true;
      }
    }
    if (dev) {
      sendHand({
        ...dest,
        cards: { lumber: 0, brick: 0, wool: -1, grain: -1, ore: -1, unknown: 0 },
        message: feedHandMessage(root),
      });
    }
  }

  function parseBankTrade(el) {
    const root = feedMessageRoot(el) || el;
    const part = root.querySelector('[class*="messagePart"]') || root;
    const textLower = (part.textContent || "").toLowerCase();
    if (!textLower.includes(SNIPS.gaveBank)) return;
    const actor = extractLeadActor(part);
    const dest = actorDestination(el, actor);
    if (!dest) return;
    const html = root.innerHTML;
    const hi = html.toLowerCase();
    let gi = hi.indexOf("gave bank:");
    if (gi < 0) gi = hi.indexOf(SNIPS.gaveBank);
    if (gi < 0) return;
    let ti = hi.indexOf(" and took ", gi);
    if (ti < 0) ti = hi.indexOf(" and took", gi);
    if (ti < 0) ti = hi.indexOf(SNIPS.tookBank, gi);
    if (ti < 0) return;
    const c = cardsDelta();
    const gavePart = html.slice(gi, ti).split("<img");
    const tookPart = html.slice(ti).split("<img");
    addFromHtmlFragments(gavePart, -1, c);
    addFromHtmlFragments(tookPart, 1, c);
    if (deltaSum(c) === 0) return;
    sendHand({ ...dest, cards: c, message: feedHandMessage(root) });
  }

  /**
   * "Name wants to give [cards] for [cards]" is only an offer — do not change resource totals.
   * Completed trades are handled in parsePlayerTrade when " traded with: " appears.
   */
  function parseWantsGiveFor(_el) {
    /* intentionally no-op */
  }

  function parsePlayerTrade(el, prev) {
    const root = feedMessageRoot(el) || el;
    const part = root.querySelector('[class*="messagePart"]') || root;
    const logMsg = feedHandMessage(root);
    const text = part.textContent || "";
    if (!text.includes(SNIPS.tradedWith) || !prev) return;
    const parts = text.split(SNIPS.tradedWith);
    const agreeing = (parts[1] || "").trim();
    const actor = extractLeadActor(part);
    const actorDest = actorDestination(el, actor);
    if (!actorDest) return;
    const hexB = hexForPlayerNameLoose(root, agreeing);
    if (!hexB) return;
    const prevRoot = feedMessageRoot(prev) || prev;
    const html = prevRoot.innerHTML || "";
    const hLower = html.toLowerCase();
    const wi = hLower.indexOf(SNIPS.wantsGive);
    const fi = hLower.indexOf(SNIPS.giveFor, wi + 1);
    if (wi < 0 || fi < 0) return;
    const givePart = html.slice(wi, fi).split("<img");
    const forPart = html.slice(fi).split("<img");
    const gave = cardsDelta();
    const forg = cardsDelta();
    addFromHtmlFragments(givePart, 1, gave);
    addFromHtmlFragments(forPart, 1, forg);
    for (const k of Object.keys(gave)) {
      if (gave[k]) {
        sendHand({ ...actorDest, cards: { [k]: -gave[k] }, message: logMsg });
        sendHand({ colorHex: hexB, cards: { [k]: gave[k] }, message: logMsg });
      }
    }
    for (const k of Object.keys(forg)) {
      if (forg[k]) {
        sendHand({ colorHex: hexB, cards: { [k]: -forg[k] }, message: logMsg });
        sendHand({ ...actorDest, cards: { [k]: forg[k] }, message: logMsg });
      }
    }
  }

  /** "Crow stole [card] from Smitt" — card back → unknown; specific art → typed. */
  function parseStoleLine(el) {
    const root = feedMessageRoot(el) || el;
    const part = root.querySelector('[class*="messagePart"]') || root;
    const logMsg = feedHandMessage(root);
    const text = part.textContent || "";
    const lower = text.toLowerCase();
    const stoleAt = lower.indexOf(" stole ");
    const fromAt = lower.lastIndexOf(" from ");
    if (stoleAt < 0 || fromAt < 0 || fromAt <= stoleAt) return;
    let stealerDest;
    const lead = lower.trimStart();
    if (lead.startsWith("you stole ") || /^you\s+stole\b/.test(lead)) {
      /**
       * Do not pass `extractLeadActor().hex` here: Colonist renders “You” as plain text and
       * only the *victim* is in a colored span, so the first bold/colored span is Raney’s
       * hex. `applyGameLogDelta` prefers `detail.colorHex`, which would credit +stolen cards
       * to the victim row.
       */
      stealerDest = { targetYou: true };
    } else {
      const stealer = extractLeadActor(part);
      if (normalizePlayerNameToken(stealer.name) === "you") {
        stealerDest = { targetYou: true };
      } else {
        stealerDest = actorDestination(el, stealer);
        if (!stealerDest) return;
      }
    }
    let victimName = text.slice(fromAt + SNIPS.stoleFrom.length).trim();
    victimName = victimName.replace(/[\u200e\u200f\u202a-\u202e]/g, "").trim();
    victimName = victimName.split(/\r?\n/)[0].trim();
    if (!victimName) return;
    const victimNorm = normalizePlayerNameToken(victimName);
    const victimHex = victimNorm === "you" ? "" : hexForPlayerNameLoose(root, victimName);
    const gain = cardsDelta();
    addFromImgsFeedRow(root, 1, gain);
    if (deltaSum(gain) === 0) {
      addFromHtmlFragments((root.innerHTML || "").split("<img"), 1, gain);
    }
    if (deltaSum(gain) === 0) {
      addFromInlineAlts(root.innerHTML || "", 1, gain);
    }
    const hidden = countHiddenResourceCardImgs(root);
    let typed = false;
    for (const k of Object.keys(gain)) {
      if (gain[k] > 0) typed = true;
    }
    const victimTag =
      victimNorm === "you" || !victimName
        ? {}
        : { player: victimName.split(/\s+/)[0] || victimName };
    if (typed) {
      for (const k of Object.keys(gain)) {
        const n = gain[k];
        if (n <= 0) continue;
        sendHand({ ...stealerDest, cards: { [k]: n }, message: logMsg });
        if (victimNorm === "you") {
          sendHand({ targetYou: true, cards: { [k]: -n }, message: logMsg });
        } else if (victimHex) {
          sendHand({
            colorHex: victimHex,
            ...victimTag,
            cards: { [k]: -n },
            message: logMsg,
          });
        } else if (victimTag.player) {
          sendHand({ ...victimTag, cards: { [k]: -n }, message: logMsg });
        }
      }
    } else if (hidden > 0) {
      sendHand({ ...stealerDest, cards: { unknown: hidden }, message: logMsg });
      if (victimNorm === "you") {
        sendHand({ targetYou: true, cards: { unknown: -hidden }, message: logMsg });
      } else if (victimHex) {
        sendHand({
          colorHex: victimHex,
          ...victimTag,
          cards: { unknown: -hidden },
          message: logMsg,
        });
      } else if (victimTag.player) {
        sendHand({ ...victimTag, cards: { unknown: -hidden }, message: logMsg });
      }
    }
  }

  function processLine(el, prev) {
    const root = feedMessageRoot(el) || el;
    const msg = lineText(root);
    sendFeedLine(feedDisplayMessage(root));
    if (isMatchStartLine(msg)) {
      const now = Date.now();
      if (now - lastResetSentAt > 15000) {
        lastResetSentAt = now;
        sendMatchResetMeta();
      }
    }
    try {
      sniffLocalPlayerFromRow(el);
      parseReceivedStartingResources(el);
      parseGaveAndGotFromPlayer(el);
      parseGot(el);
      parseDiscard(el);
      parseBuilt(el);
      parseBought(el);
      parseBankTrade(el);
      parseWantsGiveFor(el);
      parsePlayerTrade(el, prev);
      parseStoleLine(el);
      parseStoleLegacy(el, prev);
      parseFeedAwards(el);
    } catch (e) {
      const m = e?.message || String(e);
      console.warn("[Colonist analyst] game-log processLine:", m);
    }
  }

  function parseStoleLegacy(el, prev) {
    const root = feedMessageRoot(el) || el;
    const part = root.querySelector('[class*="messagePart"]') || root;
    const text = part.textContent || "";
    if (!text.toLowerCase().includes("stole:") || !prev) return;
    const prevRoot = feedMessageRoot(prev) || prev;
    const prevPart = prevRoot.querySelector('[class*="messagePart"]') || prevRoot;
    const prevText = prevPart.textContent || "";
    if (!prevText.includes(" stole from: ")) return;
    const involved = prevText.replace(" stole from: ", " ").trim().split(/\s+/);
    const stealerName = involved[0];
    const victimName = involved[1];
    const stealerHex = hexForPlayerNameLoose(prevRoot, stealerName);
    const victimHex = hexForPlayerNameLoose(prevRoot, victimName);
    const gain = cardsDelta();
    addFromImgsFeedRow(root, 1, gain);
    const hidden = countHiddenResourceCardImgs(root);
    let typed = false;
    for (const k of Object.keys(gain)) {
      if (gain[k] > 0) typed = true;
    }
    const legacyMsg = feedHandMessage(root);
    if (typed && stealerHex) {
      for (const k of Object.keys(gain)) {
        const n = gain[k];
        if (n <= 0) continue;
        sendHand({ colorHex: stealerHex, cards: { [k]: n }, message: legacyMsg });
        if (victimHex)
          sendHand({ colorHex: victimHex, cards: { [k]: -n }, message: legacyMsg });
      }
    } else if (hidden > 0 && stealerHex) {
      sendHand({ colorHex: stealerHex, cards: { unknown: hidden }, message: legacyMsg });
      if (victimHex)
        sendHand({ colorHex: victimHex, cards: { unknown: -hidden }, message: legacyMsg });
    }
  }

  function scanFeed(root) {
    const rowList = [...root.querySelectorAll('[class*="feedMessage"]')];
    rowList.sort((a, b) => {
      const ia = Number(rowIndexKey(a));
      const ib = Number(rowIndexKey(b));
      const na = Number.isFinite(ia) ? ia : Number.POSITIVE_INFINITY;
      const nb = Number.isFinite(ib) ? ib : Number.POSITIVE_INFINITY;
      if (na !== nb) return na - nb;
      return 0;
    });

    let visibleMinIndex = Infinity;
    let visibleMaxIndex = -1;
    for (const el of rowList) {
      const idx = Number(rowIndexKey(el));
      if (!Number.isFinite(idx)) continue;
      if (idx < visibleMinIndex) visibleMinIndex = idx;
      if (idx > visibleMaxIndex) visibleMaxIndex = idx;
    }

    // Reset only when early indices now map to different content (likely a new match).
    if (visibleMaxIndex >= 0 && visibleMinIndex < 80 && seenRowFingerprintByIndex.size > 0) {
      let conflictCount = 0;
      for (const el of rowList) {
        const idx = rowIndexKey(el);
        if (!idx) continue;
        const n = Number(idx);
        if (!Number.isFinite(n) || n >= 80) continue;
        const fp = messageFingerprint(el);
        const prevFp = seenRowFingerprintByIndex.get(idx);
        if (prevFp && prevFp !== fp) conflictCount += 1;
        if (conflictCount >= 2) break;
      }
      if (conflictCount >= 2) {
        seenRowFingerprintByIndex.clear();
        seenMessageKeys.clear();
      }
    }

    let prev = null;
    for (const el of rowList) {
      const fp = messageFingerprint(el);
      if (!fp || fp.length < 4) {
        prev = el;
        continue;
      }

      const idx = rowIndexKey(el);
      if (idx) {
        const prevFp = seenRowFingerprintByIndex.get(idx);
        if (prevFp === fp) {
          prev = el;
          continue;
        }
        seenRowFingerprintByIndex.set(idx, fp);
        if (seenRowFingerprintByIndex.size > SEEN_MAX * 4) {
          const it = seenRowFingerprintByIndex.keys();
          for (
            let i = 0;
            i < 400 && seenRowFingerprintByIndex.size > SEEN_MAX * 4 - 400;
            i++
          ) {
            const n = it.next();
            if (n.done) break;
            seenRowFingerprintByIndex.delete(n.value);
          }
        }
      } else {
        if (seenMessageKeys.has(fp)) {
          prev = el;
          continue;
        }
        rememberKey(fp);
      }
      processLine(el, prev);
      prev = el;
    }
  }

  function scheduleScan(root) {
    if (scanTimer) return;
    scanTimer = window.setTimeout(() => {
      scanTimer = 0;
      try {
        scanFeed(root);
      } catch {
        /* ignore */
      }
    }, 60);
  }

  function attachLogObserver() {
    const root = findVirtualFeedRoot();
    if (!root) {
      if (feedRootEl) {
        feedRootEl = null;
        seenMessageKeys.clear();
        seenRowFingerprintByIndex.clear();
        if (observer) {
          observer.disconnect();
          observer = null;
        }
      }
      return;
    }

    if (root !== feedRootEl) {
      feedRootEl = root;
      // Keep dedupe memory across root remounts to avoid double-counting past events.
      // Fallback key set can be dropped safely because data-index dedupe is primary.
      seenMessageKeys.clear();
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    }

    scheduleScan(root);

    if (!observer) {
      observer = new MutationObserver(() => scheduleScan(root));
      observer.observe(root, { childList: true, subtree: true, characterData: true });
    }
  }

  setInterval(attachLogObserver, 500);
})();
