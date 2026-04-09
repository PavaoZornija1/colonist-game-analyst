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
    const part = el.querySelector('[class*="messagePart"]') || el;
    const t = (part.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200);
    const imgs = [...part.querySelectorAll("img")]
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
    return { name, hex };
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
  function hexForPlayerNameLoose(part, name) {
    let h = hexForPlayerNameInPart(part, name);
    if (h) return h;
    const want = normalizePlayerNameToken(name);
    if (!want) return "";
    const head = want.split(/\s+/)[0];
    if (head && head !== want) {
      h = hexForPlayerNameInPart(part, head);
      if (h) return h;
    }
    const spans = part.querySelectorAll('span[style*="color"]');
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

  function countHiddenResourceCardImgs(part) {
    let n = 0;
    for (const img of part.querySelectorAll("img")) {
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
  function resourceSummaryFromImgs(part) {
    const c = cardsDelta();
    addFromImgs(part, 1, c);
    if (deltaSum(c) === 0) {
      addFromHtmlFragments((part.innerHTML || "").split("<img"), 1, c);
    }
    if (deltaSum(c) === 0) return "";
    const bits = [];
    if (c.lumber) bits.push(`wood×${c.lumber}`);
    if (c.brick) bits.push(`brick×${c.brick}`);
    if (c.wool) bits.push(`wool×${c.wool}`);
    if (c.grain) bits.push(`wheat×${c.grain}`);
    if (c.ore) bits.push(`ore×${c.ore}`);
    if (c.unknown) bits.push(`?×${c.unknown}`);
    return bits.join(", ");
  }

  function feedDisplayMessage(part) {
    const base = lineText(part);
    if (!base) return base;
    const lower = base.toLowerCase();
    const wantsImgSummary =
      lower.includes("wants to give") ||
      lower.includes(" got ") ||
      lower.includes(" received ") ||
      lower.includes(" stole ") ||
      lower.includes("starting resource") ||
      lower.includes("gave bank") ||
      lower.includes("discarded") ||
      lower.includes(" traded with: ");
    if (!wantsImgSummary) return base;
    const extra = resourceSummaryFromImgs(part);
    if (!extra) return base;
    return `${base} — ${extra}`.replace(/\s+/g, " ").trim();
  }

  function sendHand(detail) {
    const cards = detail.cards;
    if (!cards || typeof cards !== "object") return;
    if (deltaSum(cards) === 0) return;
    if (!detail.colorHex && !detail.targetYou) return;
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

  function isMatchStartLine(text) {
    const s = String(text || "").toLowerCase();
    return s.includes("happy settling");
  }

  function addFromImgs(el, sign, into) {
    for (const img of el.querySelectorAll("img")) {
      const srcRaw = img.src || "";
      const src = srcRaw.toLowerCase();
      const alt = ` ${img.alt || ""} `.toLowerCase();
      if (src.includes("card_rescardback") || alt.includes(" resource card ")) continue;
      if (
        src.includes("card_lumber") ||
        src.includes("lumber") ||
        src.includes("wood") ||
        alt.includes(" lumber ") ||
        alt.includes(" wood ")
      )
        into.lumber += sign;
      else if (src.includes("card_brick") || src.includes("brick") || alt.includes(" brick "))
        into.brick += sign;
      else if (src.includes("card_wool") || src.includes("wool") || alt.includes(" wool "))
        into.wool += sign;
      else if (
        src.includes("card_grain") ||
        src.includes("card_wheat") ||
        src.includes("grain") ||
        src.includes("wheat") ||
        alt.includes(" grain ") ||
        alt.includes(" wheat ")
      )
        into.grain += sign;
      else if (src.includes("card_ore") || alt.includes(" ore ")) into.ore += sign;
    }
  }

  function addFromHtmlFragments(parts, sign, into) {
    for (const frag of parts) {
      const f = String(frag || "").toLowerCase();
      if (f.includes("card_rescardback") || f.includes("alt=\"resource card\"")) into.unknown += sign;
      else if (f.includes("card_wool") || f.includes("alt=\"wool\"")) into.wool += sign;
      else if (f.includes("card_lumber") || f.includes("alt=\"lumber\"")) into.lumber += sign;
      else if (f.includes("card_brick") || f.includes("alt=\"brick\"")) into.brick += sign;
      else if (
        f.includes("card_grain") ||
        f.includes("card_wheat") ||
        f.includes("alt=\"grain\"") ||
        f.includes("alt=\"wheat\"")
      )
        into.grain += sign;
      else if (f.includes("card_ore") || f.includes("alt=\"ore\"")) into.ore += sign;
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
    const actor = extractLeadActor(part);
    if (actor.name) sendLocalMeta(actor.name, actor.hex);
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
    const part = el.querySelector('[class*="messagePart"]') || el;
    const msg = lineText(part);
    const lower = (part.textContent || "").toLowerCase();
    if (!lower.includes("starting resource")) return;
    const actor = extractLeadActor(part);
    const dest = actorDestination(el, actor);
    if (!dest) return;
    const c = cardsDelta();
    addFromImgs(part, 1, c);
    if (deltaSum(c) === 0) {
      addFromHtmlFragments((part.innerHTML || "").split("<img"), 1, c);
    }
    if (deltaSum(c) === 0) return;
    sendHand({ ...dest, cards: c, message: msg });
  }

  function parseGaveAndGotFromPlayer(el) {
    const part = el.querySelector('[class*="messagePart"]') || el;
    const msg = lineText(part);
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

    const gaveHtml = html.slice(gaveHi + " gave ".length, andGotHi);
    const gotHtml = html.slice(andGotHi + " and got ".length, fromHi);

    const actor = extractLeadActor(part);
    const actorDest = actorDestination(el, actor);
    if (!actorDest) return;

    const gaveC = cardsDelta();
    addFromHtmlFragments(gaveHtml.split("<img"), 1, gaveC);
    const gotC = cardsDelta();
    addFromHtmlFragments(gotHtml.split("<img"), 1, gotC);

    const partnerName = text.slice(fromI + " from ".length).trim();
    const partnerNorm = normalizePlayerNameToken(partnerName);
    const partnerHex =
      partnerNorm === "bank" || partnerNorm.startsWith("bank ")
        ? ""
        : hexForPlayerNameLoose(part, partnerName);

    for (const k of Object.keys(gaveC)) {
      if (!gaveC[k]) continue;
      sendHand({ ...actorDest, cards: { [k]: -gaveC[k] }, message: msg });
      if (partnerHex) sendHand({ colorHex: partnerHex, cards: { [k]: gaveC[k] }, message: msg });
    }
    for (const k of Object.keys(gotC)) {
      if (!gotC[k]) continue;
      sendHand({ ...actorDest, cards: { [k]: gotC[k] }, message: msg });
      if (partnerHex) sendHand({ colorHex: partnerHex, cards: { [k]: -gotC[k] }, message: msg });
    }
  }

  function parseGot(el) {
    const part = el.querySelector('[class*="messagePart"]') || el;
    const msg = lineText(part);
    const text = part.textContent || "";
    const lower = text.toLowerCase();
    if (lower.includes(" gave ") && lower.includes(" and got ") && lower.includes(" from ")) return;
    if (lower.includes("starting resource")) return;
    const gotAt = lower.indexOf(" got ");
    const recvAt = lower.indexOf(" received ");
    if (gotAt < 0 && recvAt < 0) return;
    const actor = extractLeadActor(part);
    const dest = actorDestination(el, actor);
    if (!dest) return;
    const c = cardsDelta();
    addFromImgs(part, 1, c);
    if (deltaSum(c) === 0) {
      addFromHtmlFragments((part.innerHTML || "").split("<img"), 1, c);
    }
    if (deltaSum(c) === 0) return;
    sendHand({ ...dest, cards: c, message: msg });
  }

  function parseDiscard(el) {
    const part = el.querySelector('[class*="messagePart"]') || el;
    const msg = lineText(part);
    const raw = part.textContent || "";
    const lower = raw.toLowerCase();
    const i = lower.indexOf("discarded");
    if (i < 0) return;
    const actor = extractLeadActor(part);
    const dest = actorDestination(el, actor);
    if (!dest) return;
    const c = cardsDelta();
    addFromImgs(part, -1, c);
    if (deltaSum(c) === 0) return;
    sendHand({ ...dest, cards: c, message: msg });
  }

  function parseBuilt(el) {
    const part = el.querySelector('[class*="messagePart"]') || el;
    const msg = lineText(part);
    const lower = (part.textContent || "").toLowerCase();
    const isPieceLine =
      lower.includes("built a ") ||
      lower.includes("built an ") ||
      lower.includes("placed a ") ||
      lower.includes("placed an ");
    if (!isPieceLine) return;
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
    sendHand({ ...dest, cards: c, message: msg });
  }

  function parseBought(el) {
    const part = el.querySelector('[class*="messagePart"]') || el;
    const msg = lineText(part);
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
        message: msg,
      });
    }
  }

  function parseBankTrade(el) {
    const part = el.querySelector('[class*="messagePart"]') || el;
    const msg = lineText(part);
    const textLower = (part.textContent || "").toLowerCase();
    if (!textLower.includes(SNIPS.gaveBank)) return;
    const actor = extractLeadActor(part);
    const dest = actorDestination(el, actor);
    if (!dest) return;
    const html = part.innerHTML;
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
    sendHand({ ...dest, cards: c, message: msg });
  }

  /**
   * "Name wants to give [cards] for [cards]" is only an offer — do not change resource totals.
   * Completed trades are handled in parsePlayerTrade when " traded with: " appears.
   */
  function parseWantsGiveFor(_el) {
    /* intentionally no-op */
  }

  function parsePlayerTrade(el, prev) {
    const part = el.querySelector('[class*="messagePart"]') || el;
    const msg = lineText(part);
    const text = part.textContent || "";
    if (!text.includes(SNIPS.tradedWith) || !prev) return;
    const parts = text.split(SNIPS.tradedWith);
    const agreeing = (parts[1] || "").trim();
    const actor = extractLeadActor(part);
    const actorDest = actorDestination(el, actor);
    if (!actorDest) return;
    const hexB = hexForPlayerNameLoose(part, agreeing);
    if (!hexB) return;
    const prevPart = prev.querySelector('[class*="messagePart"]') || prev;
    const html = prevPart.innerHTML || "";
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
        sendHand({ ...actorDest, cards: { [k]: -gave[k] }, message: msg });
        sendHand({ colorHex: hexB, cards: { [k]: gave[k] }, message: msg });
      }
    }
    for (const k of Object.keys(forg)) {
      if (forg[k]) {
        sendHand({ colorHex: hexB, cards: { [k]: -forg[k] }, message: msg });
        sendHand({ ...actorDest, cards: { [k]: forg[k] }, message: msg });
      }
    }
  }

  /** "Crow stole [card] from Smitt" — card back → unknown; specific art → typed. */
  function parseStoleLine(el) {
    const part = el.querySelector('[class*="messagePart"]') || el;
    const msg = lineText(part);
    const text = part.textContent || "";
    const lower = text.toLowerCase();
    const stoleAt = lower.indexOf(" stole ");
    const fromAt = lower.lastIndexOf(" from ");
    if (stoleAt < 0 || fromAt < 0 || fromAt <= stoleAt) return;
    const stealer = extractLeadActor(part);
    const stealerDest = actorDestination(el, stealer);
    if (!stealerDest) return;
    const victimName = text.slice(fromAt + SNIPS.stoleFrom.length).trim();
    if (!victimName) return;
    const victimNorm = normalizePlayerNameToken(victimName);
    const victimHex = victimNorm === "you" ? "" : hexForPlayerNameLoose(part, victimName);
    const gain = cardsDelta();
    addFromImgs(part, 1, gain);
    const hidden = countHiddenResourceCardImgs(part);
    let typed = false;
    for (const k of Object.keys(gain)) {
      if (gain[k] > 0) typed = true;
    }
    if (typed) {
      for (const k of Object.keys(gain)) {
        const n = gain[k];
        if (n <= 0) continue;
        sendHand({ ...stealerDest, cards: { [k]: n }, message: msg });
        if (victimNorm === "you") {
          sendHand({ targetYou: true, cards: { [k]: -n }, message: msg });
        } else if (victimHex) {
          sendHand({ colorHex: victimHex, cards: { [k]: -n }, message: msg });
        }
      }
    } else if (hidden > 0) {
      sendHand({ ...stealerDest, cards: { unknown: hidden }, message: msg });
      if (victimNorm === "you") {
        sendHand({ targetYou: true, cards: { unknown: -hidden }, message: msg });
      } else if (victimHex) {
        sendHand({ colorHex: victimHex, cards: { unknown: -hidden }, message: msg });
      }
    }
  }

  function processLine(el, prev) {
    const part = el.querySelector('[class*="messagePart"]') || el;
    const msg = lineText(part);
    sendFeedLine(feedDisplayMessage(part));
    if (isMatchStartLine(msg)) {
      const now = Date.now();
      if (now - lastResetSentAt > 15000) {
        lastResetSentAt = now;
        sendMatchResetMeta();
      }
    }
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
  }

  function parseStoleLegacy(el, prev) {
    const part = el.querySelector('[class*="messagePart"]') || el;
    const text = part.textContent || "";
    if (!text.toLowerCase().includes("stole:") || !prev) return;
    const prevPart = prev.querySelector('[class*="messagePart"]') || prev;
    const prevText = prevPart.textContent || "";
    if (!prevText.includes(" stole from: ")) return;
    const involved = prevText.replace(" stole from: ", " ").trim().split(/\s+/);
    const stealerName = involved[0];
    const victimName = involved[1];
    const stealerHex = hexForPlayerNameLoose(prevPart, stealerName);
    const victimHex = hexForPlayerNameLoose(prevPart, victimName);
    const gain = cardsDelta();
    addFromImgs(part, 1, gain);
    const hidden = countHiddenResourceCardImgs(part);
    let typed = false;
    for (const k of Object.keys(gain)) {
      if (gain[k] > 0) typed = true;
    }
    if (typed && stealerHex) {
      for (const k of Object.keys(gain)) {
        const n = gain[k];
        if (n <= 0) continue;
        sendHand({ colorHex: stealerHex, cards: { [k]: n } });
        if (victimHex) sendHand({ colorHex: victimHex, cards: { [k]: -n } });
      }
    } else if (hidden > 0 && stealerHex) {
      sendHand({ colorHex: stealerHex, cards: { unknown: hidden } });
      if (victimHex) sendHand({ colorHex: victimHex, cards: { unknown: -hidden } });
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
