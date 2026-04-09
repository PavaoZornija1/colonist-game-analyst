/**
 * Colonist.io wire format helpers — derived from client bundles (bankState, mechanics, stateChange).
 * Merges partial updates into a snapshot for the analyst UI.
 */

export const TRACKER_STORAGE_KEY = "colonistTrackerState";

/** Standard base-game limits; Seafarers / mods may differ — we still show bank & inferred placed. */
export const DEFAULT_PIECE_LIMITS = {
  road: 15,
  settlement: 5,
  city: 4,
  ship: 15,
};

const RESOURCE_ID = {
  1: "lumber",
  2: "brick",
  3: "wool",
  4: "grain",
  5: "ore",
  6: "gold",
};

/** Shown next to type-28 `distributionType` values in the UI. */
export const DISTRIBUTION_TYPE_HINT =
  "Colonist wire enum on production grants (type 28). 0 is the usual dice payout to settlements/cities on that roll; 1 often shows when multiple players share a hex (same tile, same roll) or special payout rules.";

export function formatResourceEnumList(arr) {
  if (!Array.isArray(arr)) return "";
  return arr.map((id) => RESOURCE_ID[Number(id)] ?? `#${id}`).join(", ");
}

const DEV_CARD_ID = {
  10: "deckFace", // Colonist often lists remaining deck as repeated type ids
  11: "knight",
  12: "victoryPoint",
  13: "monopoly",
  14: "roadBuilding",
  15: "yearOfPlenty",
};

/** Standard Catan base deck size (Colonist may use the same; expansions differ). */
export const BASE_GAME_DEV_DECK_TOTAL = 25;

/** Official base-game counts (reference only; wire uses its own enums). */
export const STANDARD_DEV_DECK_COMPOSITION = [
  { label: "Knight", count: 14 },
  { label: "Victory point", count: 5 },
  { label: "Monopoly", count: 2 },
  { label: "Road building", count: 2 },
  { label: "Year of plenty", count: 2 },
];

/** Robber half-discard applies when hand size exceeds this (standard 3–4p Catan / Colonist). */
export const ROBBER_DISCARD_HAND_LIMIT_STANDARD = 7;
/** Colonist 2-player: heuristics warn at this hand size or higher (robber discard threshold). */
export const ROBBER_DISCARD_HAND_LIMIT_TWO_PLAYER = 10;

/**
 * Best-effort seat count for discard heuristics: `currentState` hints, else players with wire/mechanic data.
 * @returns {number|null} null if unknown — callers should assume standard (3+) rules.
 */
export function inferSeatCountFromTracker(state) {
  const cs =
    state?.currentState && typeof state.currentState === "object"
      ? state.currentState
      : {};
  for (const k of [
    "maxPlayers",
    "playerCount",
    "numberOfPlayers",
    "seatCount",
    "totalPlayers",
  ]) {
    const v = toFiniteNumber(cs[k]);
    if (v != null && v >= 2 && v <= 8) return v;
  }
  const p =
    state.players && typeof state.players === "object" ? state.players : {};
  let active = 0;
  for (const id of Object.keys(p)) {
    const pl = p[id];
    if (!pl || typeof pl !== "object") continue;
    if (pl.wireHandSlotCount != null) {
      active++;
      continue;
    }
    if (
      pl.bankRoadAmount != null ||
      pl.bankSettlementAmount != null ||
      pl.bankCityAmount != null
    ) {
      active++;
      continue;
    }
    if (pl.victoryPointsPublic != null) {
      active++;
      continue;
    }
    const wr = pl.wireResources;
    if (wr && typeof wr === "object") {
      let t = 0;
      for (const rn of ["lumber", "brick", "wool", "grain", "ore"])
        t += Number(wr[rn]) || 0;
      if (t > 0) {
        active++;
        continue;
      }
    }
    if (
      Array.isArray(pl.developmentCardsUsed) &&
      pl.developmentCardsUsed.length > 0
    ) {
      active++;
    }
  }
  if (active >= 2 && active <= 8) return active;
  return null;
}

/** @param {number} cardId */
export function devCardLabel(cardId) {
  return DEV_CARD_ID[cardId] || `other(${cardId})`;
}

/** @param {number[]|undefined} used */
export function summarizeDevUsed(used) {
  const out = {};
  if (!Array.isArray(used)) return out;
  for (const c of used) {
    if (typeof c !== "number") continue;
    const k = devCardLabel(c);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

/**
 * Colonist activity-feed name colors (base 4-player palette) → wire `colorId`.
 * Used to merge feed deltas into seat rows like Blue (#1).
 */
export const COLONIST_CHAT_HEX_BY_COLOR_ID = {
  2: "#223697",
  //   1: "#223697",
  1: "#e27174",
  3: "#e09742",
  4: "#62b95d",
};

export const COLONIST_CHAT_COLOR_LABEL_BY_HEX = {
  "#223697": "Blue",
  "#e27174": "Red",
  "#e09742": "Orange",
  "#62b95d": "Green",
};

/** @param {string|undefined} hex */
export function normalizeColonistChatHex(hex) {
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

/** @param {string|undefined} hex */
export function colorIdFromColonistChatHex(hex) {
  const n = normalizeColonistChatHex(hex);
  for (const [cid, h] of Object.entries(COLONIST_CHAT_HEX_BY_COLOR_ID)) {
    if (normalizeColonistChatHex(h) === n) return Number(cid);
  }
  return null;
}

/** Best-effort local seat id from wire visibility (only your seat has typed cards). */
export function inferLikelyLocalWireColorId(state) {
  const players =
    state?.players && typeof state.players === "object" ? state.players : {};
  let bestId = null;
  let bestScore = -1;
  for (const pid of Object.keys(players)) {
    const pl = players[pid];
    if (!pl || typeof pl !== "object") continue;
    if (pl.wireHandAllZeros === true) continue;
    const wr =
      pl.wireResources && typeof pl.wireResources === "object"
        ? pl.wireResources
        : null;
    if (!wr) continue;
    let typed = 0;
    for (const k of ["lumber", "brick", "wool", "grain", "ore"])
      typed += Number(wr[k]) || 0;
    if (typed <= 0) continue;
    const slots = Number(pl.wireHandSlotCount) || 0;
    const score = typed + slots;
    if (score > bestScore) {
      bestScore = score;
      bestId = Number(pl.colorId ?? pid);
    }
  }
  return bestId;
}

/** Returns local wire id only when exactly one typed/non-hidden seat is visible. */
export function inferDefiniteLocalWireColorId(state) {
  const players =
    state?.players && typeof state.players === "object" ? state.players : {};
  const candidates = [];
  for (const pid of Object.keys(players)) {
    const pl = players[pid];
    if (!pl || typeof pl !== "object") continue;
    if (pl.wireHandAllZeros === true) continue;
    const wr =
      pl.wireResources && typeof pl.wireResources === "object"
        ? pl.wireResources
        : null;
    if (!wr) continue;
    let typed = 0;
    for (const k of ["lumber", "brick", "wool", "grain", "ore"])
      typed += Number(wr[k]) || 0;
    if (typed > 0) candidates.push(Number(pl.colorId ?? pid));
  }
  if (candidates.length !== 1) return null;
  return candidates[0];
}

export function resolveFeedHexForColorId(state, colorId) {
  const cid = Number(colorId);
  const runtime =
    state?.feedHexByColorId && typeof state.feedHexByColorId === "object"
      ? state.feedHexByColorId
      : {};
  const runtimeHex = normalizeColonistChatHex(runtime[String(cid)]);
  if (runtimeHex) return runtimeHex;
  const defaultHex = normalizeColonistChatHex(
    COLONIST_CHAT_HEX_BY_COLOR_ID[cid],
  );

  const localHex = normalizeColonistChatHex(state?.logLocalPlayerColorHex);
  const localWireCid = toFiniteNumber(state?.localWireColorId);
  if (!localHex || localWireCid == null) return defaultHex;

  const defaultLocalCid = colorIdFromColonistChatHex(localHex);
  if (defaultLocalCid == null || defaultLocalCid === localWireCid)
    return defaultHex;

  // Per-match remap: only swap the local seat id with the default color-id of local feed color.
  if (cid === localWireCid) return localHex;
  if (cid === defaultLocalCid) {
    return normalizeColonistChatHex(
      COLONIST_CHAT_HEX_BY_COLOR_ID[localWireCid],
    );
  }
  return defaultHex;
}

const PLAYER_COLORS = {
  0: "—",
  1: "Blue",
  2: "Red",
  3: "Orange",
  4: "Green",
  5: "Black",
  6: "Bronze",
  7: "Silver",
  8: "Gold",
  9: "White",
  10: "Purple",
  11: "Mystic",
  12: "Pink",
};

export function initialTrackerState() {
  return {
    updatedAt: null,
    bank: emptyResources(),
    players: {},
    devCardsPlayed: {},
    rawMessageCount: 0,
    /**
     * Feed-derived hand totals keyed by normalized chat name color hex (see COLONIST_CHAT_HEX_BY_COLOR_ID).
     */
    logHandByColorHex: {},
    /** Logged-in player display name (from feed + avatar). */
    logLocalPlayerDisplayName: null,
    /** Hex color on the logged-in player’s name span — for “from you” steals. */
    logLocalPlayerColorHex: null,
    /** Runtime color-id to feed-hex mapping anchored from observed local seat. */
    feedHexByColorId: {},
    /** Local wire seat/color id from type-4 payload.playerColor (when available). */
    localWireColorId: null,
    /** Once set from trusted wire events, do not flip local seat id mid-match. */
    localWireColorIdLocked: false,
    /** Last seen feed display-name by normalized color hex. */
    feedNameByHex: {},
    logEventCount: 0,
    logUpdatedAt: null,
    /** Shallow-merged from diff.currentState (turn, timer, action, etc.). */
    currentState: {},
    /** Last server sequence on type-91 style envelopes, when present. */
    lastWireSequence: null,
    /** Recent dice rolls from diff.diceState (deduped by sequence). */
    diceHistory: [],
    /** Top-level keys seen on diff objects we do not explicitly handle (debug). */
    unknownDiffKeys: [],
    /** Robber from mechanicRobberState.locationTileIndex when present. */
    robberTileIndex: null,
    /**
     * Merged from diff.tradeState patches (activeOffers / closedOffers keys).
     * Values can be full offer objects or null placeholders from the wire.
     */
    tradeWireMirror: { activeOffers: {}, closedOffers: {} },
    tradeWireUpdatedAt: null,
    /** Last id-130 type-28 resource grant batch (dice production etc.). */
    lastProductionDistribution: null,
    /** Sum of remaining dev cards in deck from wire `bankDevelopmentCards.cards` (per-type slots). */
    devBankRemaining: null,
    /** Copy of last bankDevelopmentCards.cards array for breakdown UI. */
    devBankSlots: null,
  };
}

function emptyResources() {
  return { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0, gold: 0, other: {} };
}

function normalizeResourceCards(rc) {
  const out = emptyResources();
  if (rc == null) return out;
  if (Array.isArray(rc.cards)) {
    for (const c of rc.cards) {
      const t = c && typeof c === "object" ? (c.type ?? c.cardType) : c;
      const n = Number(t);
      if (!Number.isFinite(n) || n < 1) continue;
      const name = RESOURCE_ID[n];
      if (name) out[name] += 1;
      else out.other[String(n)] = (out.other[String(n)] || 0) + 1;
    }
    return out;
  }
  if (typeof rc === "object") {
    for (const k of Object.keys(rc)) {
      if (k === "cards") continue;
      const n = Number(k);
      const v = rc[k];
      if (!Number.isFinite(n) || typeof v !== "number") continue;
      const name = RESOURCE_ID[n];
      if (name) out[name] += v;
      else out.other[String(n)] = (out.other[String(n)] || 0) + v;
    }
  }
  return out;
}

function countDevCard(devCardsPlayed, cardId) {
  const key = devCardLabel(cardId);
  devCardsPlayed[key] = (devCardsPlayed[key] || 0) + 1;
}

function rebuildDevCardTotals(state) {
  state.devCardsPlayed = {};
  for (const pid of Object.keys(state.players)) {
    const used = state.players[pid].developmentCardsUsed;
    if (!Array.isArray(used)) continue;
    for (const c of used) {
      if (typeof c === "number") countDevCard(state.devCardsPlayed, c);
    }
  }
}

function applyDevPlayers(state, players) {
  if (!players || typeof players !== "object") return;
  for (const colorKey of Object.keys(players)) {
    const p = players[colorKey];
    if (!p || typeof p !== "object") continue;
    const used = p.developmentCardsUsed;
    if (!Array.isArray(used)) continue;
    const pid = String(colorKey);
    if (!state.players[pid]) state.players[pid] = { colorId: Number(colorKey) };
    state.players[pid].developmentCardsUsed = used.slice();
  }
}

function applyPieceMechanic(state, key, mechanicObj, field) {
  if (!mechanicObj || typeof mechanicObj !== "object") return;
  for (const colorKey of Object.keys(mechanicObj)) {
    const row = mechanicObj[colorKey];
    if (!row || typeof row !== "object") continue;
    if (row[field] == null) continue;
    const pid = String(colorKey);
    if (!state.players[pid]) state.players[pid] = { colorId: Number(colorKey) };
    state.players[pid][key] = row[field];
  }
}

/** Bank sends partial resourceCounts keyed by id ("1".."5"); merge into snapshot (do not replace whole bank). */
function mergeBankResourceCards(state, rc) {
  if (!rc || typeof rc !== "object") return;
  if (!state.bank || typeof state.bank !== "object")
    state.bank = emptyResources();
  if (!state.bank.other || typeof state.bank.other !== "object")
    state.bank.other = {};

  if (Array.isArray(rc.cards)) {
    state.bank = normalizeResourceCards(rc);
    return;
  }
  for (const k of Object.keys(rc)) {
    if (k === "cards") continue;
    const n = Number(k);
    const v = rc[k];
    if (!Number.isFinite(n) || typeof v !== "number") continue;
    const name = RESOURCE_ID[n];
    if (name) state.bank[name] = v;
    else state.bank.other[String(n)] = v;
  }
}

function applyPlayerStatesPatch(state, playerStates) {
  if (!playerStates || typeof playerStates !== "object") return;
  for (const colorKey of Object.keys(playerStates)) {
    const p = playerStates[colorKey];
    if (!p || typeof p !== "object") continue;
    const pid = String(colorKey);
    if (!state.players[pid]) state.players[pid] = { colorId: Number(colorKey) };
    if (p.resourceCards) {
      state.players[pid].wireResources = normalizeResourceCards(
        p.resourceCards,
      );
      const rawCards = p.resourceCards.cards;
      if (Array.isArray(rawCards) && rawCards.length > 0) {
        state.players[pid].wireHandSlotCount = rawCards.length;
        state.players[pid].wireHandAllZeros = rawCards.every(
          (x) => Number(x) === 0,
        );
      } else {
        state.players[pid].wireHandSlotCount = null;
        state.players[pid].wireHandAllZeros = false;
      }
    }
    if (Array.isArray(p.developmentCardsUsed)) {
      state.players[pid].developmentCardsUsed = p.developmentCardsUsed.slice();
    }
    if (p.victoryPointsState && typeof p.victoryPointsState === "object") {
      const keys = Object.keys(p.victoryPointsState);
      if (keys.length === 0) {
        /* Empty {} in a diff — do not wipe previously merged VP. */
      } else {
        const vpSum = sumVictoryPointsState(p.victoryPointsState);
        if (vpSum != null) state.players[pid].victoryPointsPublic = vpSum;
      }
    }
  }
}

function sumVictoryPointsState(vps) {
  if (!vps || typeof vps !== "object") return null;
  let s = 0;
  let any = false;
  for (const k of Object.keys(vps)) {
    const v = vps[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      s += v;
      any = true;
    }
  }
  return any ? s : null;
}

const KNOWN_DIFF_TOP_KEYS = new Set([
  "bankState",
  "playerStates",
  "mapState",
  "currentState",
  "gameLogState",
  "diceState",
  "tradeState",
  "mechanicDevelopmentCardsState",
  "mechanicRoadState",
  "mechanicSettlementState",
  "mechanicCityState",
  "mechanicShipState",
  "mechanicLongestRoadState",
  "mechanicLargestArmyState",
  "mechanicRobberState",
]);

function isProbablyDiffPatch(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  return (
    obj.bankState != null ||
    obj.playerStates != null ||
    obj.currentState != null ||
    obj.mapState != null ||
    obj.diceState != null ||
    obj.gameLogState != null ||
    obj.tradeState != null ||
    obj.mechanicRobberState != null
  );
}

function noteUnknownDiffKeys(diffRoot, state) {
  if (!diffRoot || typeof diffRoot !== "object" || Array.isArray(diffRoot))
    return;
  if (!state.unknownDiffKeys) state.unknownDiffKeys = [];
  const have = new Set(state.unknownDiffKeys);
  for (const k of Object.keys(diffRoot)) {
    if (KNOWN_DIFF_TOP_KEYS.has(k)) continue;
    if (have.has(k)) continue;
    have.add(k);
    state.unknownDiffKeys.push(k);
    if (state.unknownDiffKeys.length > 48) state.unknownDiffKeys.shift();
  }
}

function toFiniteNumber(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function extractWireSequence(parsed) {
  try {
    const d = parsed?.data;
    if (!d || typeof d !== "object") return null;
    const pay = d.payload;
    if (pay && typeof pay === "object") {
      const s = toFiniteNumber(pay.sequence);
      if (s != null) return s;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function extractTimeLeftInState(parsed) {
  try {
    const p = parsed?.data?.payload;
    if (p && typeof p === "object" && typeof p.timeLeftInState === "number")
      return p.timeLeftInState;
  } catch {
    /* ignore */
  }
  return null;
}

function appendDiceRoll(state, dice1, dice2, seq) {
  const d1 = toFiniteNumber(dice1);
  const d2 = toFiniteNumber(dice2);
  if (d1 == null || d2 == null) return;
  if (!state.diceHistory) state.diceHistory = [];
  const last = state.diceHistory[state.diceHistory.length - 1];
  if (
    last &&
    seq != null &&
    last.seq === seq &&
    last.d1 === d1 &&
    last.d2 === d2
  ) {
    return;
  }
  state.diceHistory.push({
    d1,
    d2,
    sum: d1 + d2,
    at: Date.now(),
    seq: seq ?? null,
  });
  if (state.diceHistory.length > 40) state.diceHistory.shift();
}

function applyLongestRoadState(state, mechanicObj) {
  if (!mechanicObj || typeof mechanicObj !== "object") return;
  for (const colorKey of Object.keys(mechanicObj)) {
    const row = mechanicObj[colorKey];
    if (!row || typeof row !== "object") continue;
    if (row.longestRoad == null) continue;
    const pid = String(colorKey);
    if (!state.players[pid]) state.players[pid] = { colorId: Number(colorKey) };
    state.players[pid].longestRoad = row.longestRoad;
  }
}

function applyLargestArmyState(state, mechanicObj) {
  if (!mechanicObj || typeof mechanicObj !== "object") return;
  for (const colorKey of Object.keys(mechanicObj)) {
    const row = mechanicObj[colorKey];
    if (!row || typeof row !== "object") continue;
    const v = row.largestArmy ?? row.knightsPlayed ?? row.armySize;
    if (v == null) continue;
    const pid = String(colorKey);
    if (!state.players[pid]) state.players[pid] = { colorId: Number(colorKey) };
    state.players[pid].largestArmy = v;
  }
}

/** Latest dice roll line in wire gameLogState (type 10 = first/second die). */
function extractDiceFromGameLogPatches(patches) {
  let bestKey = -Infinity;
  let best = null;
  for (const gls of patches) {
    if (!gls || typeof gls !== "object") continue;
    for (const lineKey of Object.keys(gls)) {
      const entry = gls[lineKey];
      const text = entry?.text;
      if (!text || text.type !== 10) continue;
      const fd = toFiniteNumber(text.firstDice);
      const sd = toFiniteNumber(text.secondDice);
      if (fd == null || sd == null) continue;
      const nk = Number(lineKey);
      const ord = Number.isFinite(nk) ? nk : bestKey + 1;
      if (ord >= bestKey) {
        bestKey = ord;
        best = { d1: fd, d2: sd };
      }
    }
  }
  return best;
}

function applyRobberState(state, robberObj) {
  if (!robberObj || typeof robberObj !== "object") return;
  if (typeof robberObj.locationTileIndex === "number") {
    state.robberTileIndex = robberObj.locationTileIndex;
  }
}

function applyTradeStatePatch(state, ts) {
  if (!ts || typeof ts !== "object") return;
  if (!state.tradeWireMirror || typeof state.tradeWireMirror !== "object") {
    state.tradeWireMirror = { activeOffers: {}, closedOffers: {} };
  }
  const m = state.tradeWireMirror;
  if (ts.activeOffers && typeof ts.activeOffers === "object") {
    if (!m.activeOffers || typeof m.activeOffers !== "object")
      m.activeOffers = {};
    for (const k of Object.keys(ts.activeOffers)) {
      m.activeOffers[k] = ts.activeOffers[k];
    }
  }
  if (ts.closedOffers && typeof ts.closedOffers === "object") {
    if (!m.closedOffers || typeof m.closedOffers !== "object")
      m.closedOffers = {};
    for (const k of Object.keys(ts.closedOffers)) {
      m.closedOffers[k] = ts.closedOffers[k];
    }
  }
  state.tradeWireUpdatedAt = Date.now();
}

/** id:130 data.type === 28 — per-tile resource grants after a roll. */
function applyType28Production(state, parsed) {
  const d = parsed?.data;
  if (!d || d.type !== 28 || !Array.isArray(d.payload)) return;
  const seq = extractWireSequence(parsed);
  const distTypes = new Set();
  const parts = [];
  const rows = [];
  for (const row of d.payload) {
    if (!row || typeof row !== "object") continue;
    const owner = row.owner;
    const card = row.card;
    const dt = row.distributionType;
    if (typeof dt === "number") distTypes.add(dt);
    const cn = RESOURCE_ID[Number(card)] ?? `card:${card}`;
    const dtl = typeof dt === "number" ? ` [dist ${dt}]` : "";
    parts.push(`color ${owner} ← ${cn}${dtl}`);
    rows.push({
      owner: toFiniteNumber(owner),
      card: cn,
      distributionType: toFiniteNumber(dt),
    });
  }
  state.lastProductionDistribution = {
    summary: parts.length ? parts.join(" · ") : "(no rows)",
    distributionTypes: [...distTypes].sort((a, b) => a - b),
    rows,
    sequence: seq ?? null,
    at: Date.now(),
  };
}

function visitForPatches(obj, acc) {
  if (obj == null || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (const item of obj) visitForPatches(item, acc);
    return;
  }

  if (obj.stateChange) visitForPatches(obj.stateChange, acc);
  if (obj.gameState) visitForPatches(obj.gameState, acc);
  if (obj.payload != null && typeof obj.payload === "object")
    visitForPatches(obj.payload, acc);
  if (obj.data != null && typeof obj.data === "object")
    visitForPatches(obj.data, acc);
  if (obj.diff != null && typeof obj.diff === "object")
    visitForPatches(obj.diff, acc);

  if (obj.bankState) acc.bankPatches.push(obj.bankState);
  if (obj.playerStates) acc.playerPatches.push(obj.playerStates);
  if (obj.mechanicDevelopmentCardsState)
    acc.devPatches.push(obj.mechanicDevelopmentCardsState);
  if (obj.mechanicRoadState) acc.roadPatches.push(obj.mechanicRoadState);
  if (obj.mechanicSettlementState)
    acc.settlementPatches.push(obj.mechanicSettlementState);
  if (obj.mechanicCityState) acc.cityPatches.push(obj.mechanicCityState);
  if (obj.mechanicShipState) acc.shipPatches.push(obj.mechanicShipState);
  if (obj.mechanicLongestRoadState)
    acc.longestRoadPatches.push(obj.mechanicLongestRoadState);
  if (obj.mechanicLargestArmyState)
    acc.largestArmyPatches.push(obj.mechanicLargestArmyState);
  if (obj.mechanicRobberState) acc.robberPatches.push(obj.mechanicRobberState);
  if (obj.diceState) acc.dicePatches.push(obj.diceState);
  if (obj.gameLogState) acc.gameLogPatches.push(obj.gameLogState);
  if (obj.tradeState) acc.tradePatches.push(obj.tradeState);
  if (obj.currentState) acc.currentStatePatches.push(obj.currentState);

  if (
    acc.seenDiffRoots &&
    isProbablyDiffPatch(obj) &&
    !acc.seenDiffRoots.has(obj)
  ) {
    acc.seenDiffRoots.add(obj);
    acc.diffRootsForKeys.push(obj);
  }

  if (Array.isArray(obj.events)) {
    for (const ev of obj.events) visitForPatches(ev, acc);
  }
}

export function tryParseJson(data) {
  if (typeof data !== "string") return null;
  const t = data.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

/**
 * @param {ReturnType<typeof initialTrackerState>} state
 * @param {unknown} parsed
 */
export function applyParsedMessage(state, parsed) {
  try {
    const d = parsed?.data;
    if (d && typeof d === "object" && d.type === 4) {
      const pc = toFiniteNumber(d?.payload?.playerColor);
      if (pc != null) {
        if (state.localWireColorIdLocked !== true) {
          state.localWireColorId = pc;
          state.localWireColorIdLocked = true;
        } else if (state.localWireColorId == null) {
          state.localWireColorId = pc;
        }
      }
    }
  } catch {
    /* ignore */
  }

  const seq = extractWireSequence(parsed);
  if (seq != null) state.lastWireSequence = seq;

  applyType28Production(state, parsed);

  const acc = {
    seenDiffRoots: new WeakSet(),
    diffRootsForKeys: [],
    bankPatches: [],
    playerPatches: [],
    devPatches: [],
    roadPatches: [],
    settlementPatches: [],
    cityPatches: [],
    shipPatches: [],
    longestRoadPatches: [],
    largestArmyPatches: [],
    dicePatches: [],
    gameLogPatches: [],
    robberPatches: [],
    tradePatches: [],
    currentStatePatches: [],
  };
  visitForPatches(parsed, acc);

  for (const root of acc.diffRootsForKeys) {
    noteUnknownDiffKeys(root, state);
  }

  if (!state.currentState || typeof state.currentState !== "object")
    state.currentState = {};
  for (const patch of acc.currentStatePatches) {
    if (patch && typeof patch === "object")
      Object.assign(state.currentState, patch);
  }
  const tLeft = extractTimeLeftInState(parsed);
  if (tLeft != null) state.currentState.timeLeftInState = tLeft;

  const mergedDice = {};
  for (const ds of acc.dicePatches) {
    if (ds && typeof ds === "object") Object.assign(mergedDice, ds);
  }
  const fromLog = extractDiceFromGameLogPatches(acc.gameLogPatches);

  let rollD1 = null;
  let rollD2 = null;
  for (let i = acc.dicePatches.length - 1; i >= 0; i--) {
    const ds = acc.dicePatches[i];
    if (!ds || typeof ds !== "object") continue;
    if (ds.diceThrown === true) {
      const a = toFiniteNumber(ds.dice1);
      const b = toFiniteNumber(ds.dice2);
      if (a != null && b != null) {
        rollD1 = a;
        rollD2 = b;
        break;
      }
    }
  }
  if ((rollD1 == null || rollD2 == null) && fromLog) {
    rollD1 = toFiniteNumber(fromLog.d1);
    rollD2 = toFiniteNumber(fromLog.d2);
  }
  if ((rollD1 == null || rollD2 == null) && mergedDice.diceThrown === true) {
    rollD1 = toFiniteNumber(mergedDice.dice1);
    rollD2 = toFiniteNumber(mergedDice.dice2);
  }
  if (rollD1 != null && rollD2 != null) {
    appendDiceRoll(state, rollD1, rollD2, seq);
  }

  for (const rb of acc.robberPatches) {
    applyRobberState(state, rb);
  }

  for (const tr of acc.tradePatches) {
    applyTradeStatePatch(state, tr);
  }

  for (const bp of acc.bankPatches) {
    if (bp.resourceCards) mergeBankResourceCards(state, bp.resourceCards);
  }

  for (const ps of acc.playerPatches) {
    applyPlayerStatesPatch(state, ps);
  }

  for (const dp of acc.devPatches) {
    applyDevPlayers(state, dp.players);
    const bdc = dp.bankDevelopmentCards;
    if (bdc && typeof bdc === "object" && Array.isArray(bdc.cards)) {
      state.devBankSlots = bdc.cards.map((x) => toFiniteNumber(x) ?? 0);
      /* Remaining deck size is the list length (each entry is a card type in stack order). */
      state.devBankRemaining = bdc.cards.length;
    }
  }

  for (const rp of acc.roadPatches) {
    applyPieceMechanic(state, "bankRoadAmount", rp, "bankRoadAmount");
  }
  for (const sp of acc.settlementPatches) {
    applyPieceMechanic(
      state,
      "bankSettlementAmount",
      sp,
      "bankSettlementAmount",
    );
  }
  for (const cp of acc.cityPatches) {
    applyPieceMechanic(state, "bankCityAmount", cp, "bankCityAmount");
  }
  for (const sh of acc.shipPatches) {
    applyPieceMechanic(state, "bankShipAmount", sh, "bankShipAmount");
  }

  for (const lr of acc.longestRoadPatches) {
    applyLongestRoadState(state, lr);
  }
  for (const la of acc.largestArmyPatches) {
    applyLargestArmyState(state, la);
  }

  rebuildDevCardTotals(state);
  state.updatedAt = Date.now();
  return state;
}

function emptyFeedHandRow() {
  return { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0, unknown: 0 };
}

/**
 * Apply one feed-derived hand delta (keyed by Colonist name-color hex).
 * @param {ReturnType<typeof initialTrackerState>} state
 * @param {{ colorHex?: string, targetYou?: boolean, cards: Record<string, number> }} detail
 */
export function applyGameLogDelta(state, detail) {
  if (!detail || typeof detail !== "object" || typeof detail.cards !== "object")
    return state;

  let hex = "";
  if (detail.targetYou === true) {
    hex = normalizeColonistChatHex(state.logLocalPlayerColorHex);
  } else {
    hex = normalizeColonistChatHex(detail.colorHex);
  }
  if (!hex) return state;

  if (!state.logHandByColorHex || typeof state.logHandByColorHex !== "object") {
    state.logHandByColorHex = {};
  }
  if (!state.feedNameByHex || typeof state.feedNameByHex !== "object") {
    state.feedNameByHex = {};
  }
  if (!state.logHandByColorHex[hex]) {
    state.logHandByColorHex[hex] = emptyFeedHandRow();
  }
  if (typeof detail.player === "string") {
    const nm = detail.player.trim();
    if (nm) state.feedNameByHex[hex] = nm;
  }
  const row = state.logHandByColorHex[hex];
  const std = ["lumber", "brick", "wool", "grain", "ore", "unknown"];
  for (const k of std) {
    const v = detail.cards[k];
    if (typeof v !== "number" || v === 0) continue;
    row[k] = (row[k] || 0) + v;
  }
  state.logEventCount = (state.logEventCount || 0) + 1;
  state.logUpdatedAt = Date.now();
  return state;
}

/** Merge feed row for a seat’s colorId (match any hex that maps to that id). */
export function feedHandRowForColorId(state, colorId) {
  const cid = Number(colorId);
  const byHex =
    state.logHandByColorHex && typeof state.logHandByColorHex === "object"
      ? state.logHandByColorHex
      : {};
  const preferred = resolveFeedHexForColorId(state, cid);
  if (preferred && byHex[preferred]) return { ...byHex[preferred] };
  for (const h of Object.keys(byHex)) {
    if (colorIdFromColonistChatHex(h) === cid) {
      return { ...byHex[h] };
    }
  }
  return emptyFeedHandRow();
}

/**
 * @param {ReturnType<typeof initialTrackerState>} state
 * @param {{ kind: string, detail?: Record<string, unknown> }} payload
 */
export function applyAnalystPayload(state, payload) {
  if (payload?.kind !== "ws-message" && payload?.kind !== "ws-send")
    return state;

  const detail = payload?.detail;
  let parsed = null;
  const dec = detail?.decoded;
  if (dec != null && typeof dec === "object") {
    parsed = dec;
  } else if (typeof detail?.data === "string") {
    parsed = tryParseJson(detail.data);
  } else if (typeof detail?.rawPreview === "string") {
    parsed = tryParseJson(detail.rawPreview);
  }

  if (parsed == null) return state;
  applyParsedMessage(state, parsed);
  state.rawMessageCount += 1;
  return state;
}

export function playerLabel(colorId) {
  const n = Number(colorId);
  return PLAYER_COLORS[n] ?? `Color ${n}`;
}

function dynamicSeatLabel(state, colorId) {
  const hx = resolveFeedHexForColorId(state, colorId);
  const known = hx ? COLONIST_CHAT_COLOR_LABEL_BY_HEX[hx] : "";
  return known || playerLabel(colorId);
}

/** True for Colonist keep-alive / clock messages (id 136 + timestamp only). */
export function isHeartbeatDecoded(dec) {
  if (!dec || typeof dec !== "object") return false;
  if (String(dec.id) !== "136") return false;
  const data = dec.data;
  if (!data || typeof data !== "object") return false;
  const keys = Object.keys(data);
  return keys.length === 1 && keys[0] === "timestamp";
}

/**
 * Client→server keep-alive is often the same 36-byte msgpack as id 136 (opaque in the log).
 * Safe to hide alongside decoded heartbeats; other game actions use different sizes.
 */
export function isLikelyWsSendPing(detail) {
  const r = detail?.rawPreview;
  return typeof r === "string" && /^opaque 36 B:/i.test(r.trim());
}

/** True for undecoded binary frames or opaque hex previews (noise in the event list). */
export function isOpaqueBinaryWsDetail(detail) {
  if (!detail || typeof detail !== "object") return false;
  if (detail.encoding === "binary") return true;
  const r = detail.rawPreview;
  return typeof r === "string" && /^\s*opaque\s+\d+\s+B:/i.test(r);
}

/**
 * Lightweight tips from bank + wire hands (not full AI).
 * @param {ReturnType<typeof initialTrackerState>} state
 */
export function buildHeuristics(state) {
  const tips = [];
  const bank = state.bank || emptyResources();
  const standard = ["lumber", "brick", "wool", "grain", "ore"];
  let scarcest = Infinity;
  const scarcestNames = [];
  for (const n of standard) {
    const v = Number(bank[n]) || 0;
    if (v <= 1) {
      tips.push(`Bank low on ${n} (${v} in supply).`);
    }
    if (v < scarcest) {
      scarcest = v;
      scarcestNames.length = 0;
      scarcestNames.push(n);
    } else if (v === scarcest) {
      scarcestNames.push(n);
    }
  }
  if (scarcest < Infinity && scarcest >= 2 && scarcestNames.length > 0) {
    tips.push(
      `Scarcest in bank right now: ${scarcestNames.join(", ")} (${scarcest}).`,
    );
  }
  const seats = inferSeatCountFromTracker(state);
  const twoPlayer = seats === 2;
  const standardLimit = ROBBER_DISCARD_HAND_LIMIT_STANDARD;
  /* Standard Catan: discard when strictly over 7 → tip at 8+. Colonist 2p: user-confirmed at ≥10. */
  const warnAt = twoPlayer
    ? ROBBER_DISCARD_HAND_LIMIT_TWO_PLAYER
    : standardLimit + 1;
  const discardPhrase = twoPlayer
    ? `≥${ROBBER_DISCARD_HAND_LIMIT_TWO_PLAYER} cards on a 7 (Colonist 2-player)`
    : `over ${standardLimit} cards on a 7`;

  const players =
    state.players && typeof state.players === "object" ? state.players : {};
  for (const pid of Object.keys(players)) {
    const pl = players[pid];
    const wr = pl.wireResources;
    if (!wr || typeof wr !== "object") continue;
    let total = 0;
    for (const n of standard) total += Number(wr[n]) || 0;
    const slots = pl.wireHandSlotCount;
    const hidden = pl.wireHandAllZeros && slots > 0;
    const cardCount = hidden ? slots : total;
    const seatName = dynamicSeatLabel(state, pl.colorId ?? Number(pid));
    if (hidden && cardCount >= warnAt) {
      tips.push(
        `${seatName} has ${cardCount} hidden cards on the wire (robber discard if ${discardPhrase}).`,
      );
    } else if (!hidden && total >= warnAt) {
      tips.push(
        `${seatName} holds ${total} cards (robber discard if ${discardPhrase}).`,
      );
    }
  }
  return tips;
}
