import {
  TRACKER_STORAGE_KEY,
  initialTrackerState,
  playerLabel,
  DEFAULT_PIECE_LIMITS,
  summarizeDevUsed,
  isHeartbeatDecoded,
  isLikelyWsSendPing,
  isOpaqueBinaryWsDetail,
  buildHeuristics,
  DISTRIBUTION_TYPE_HINT,
  formatResourceEnumList,
  BASE_GAME_DEV_DECK_TOTAL,
  STANDARD_DEV_DECK_COMPOSITION,
  devCardLabel,
  feedHandRowForColorId,
  colorIdFromColonistChatHex,
} from "./colonist-tracker.js";

const SESSION_KEY = "colonistAnalystEvents";
const ONBOARD_KEY = "colonistAnalystOnboardDismissed";

const logEl = document.getElementById("log");
const statusEl = document.getElementById("status");
const pauseEl = document.getElementById("pause");
const clearEl = document.getElementById("clear");
const bankGridEl = document.getElementById("bank-grid");
const wireHandsWrapEl = document.getElementById("wire-hands-wrap");
const devCardsEl = document.getElementById("dev-cards");
const piecesWrapEl = document.getElementById("pieces-wrap");
const trackerMetaEl = document.getElementById("tracker-meta");
const onboardBanner = document.getElementById("onboard-banner");
const onboardDismiss = document.getElementById("onboard-dismiss");
const gameGlanceGridEl = document.getElementById("game-glance-grid");
const diceHistoryWrapEl = document.getElementById("dice-history-wrap");
const tradeWireWrapEl = document.getElementById("trade-wire-wrap");
const vpWrapEl = document.getElementById("vp-wrap");
const heuristicsListEl = document.getElementById("heuristics-list");
const unknownKeysSection = document.getElementById("unknown-keys-section");
const unknownKeysWrapEl = document.getElementById("unknown-keys-wrap");
const logSearchEl = document.getElementById("log-search");
const hideHeartbeatsEl = document.getElementById("hide-heartbeats");
const hideBinaryWsEl = document.getElementById("hide-binary-ws");
const exportJsonBtn = document.getElementById("export-json");

const MAX_ITEMS = 200;

const HANDS_TABLE_HEAD =
  '<thead><tr><th scope="col">Player</th><th scope="col" class="col-num">Lumber</th><th scope="col" class="col-num">Brick</th><th scope="col" class="col-num">Wool</th><th scope="col" class="col-num">Grain</th><th scope="col" class="col-num">Ore</th><th scope="col" class="col-num">Unknown</th></tr></thead>';

function renderUnifiedHands(state) {
  if (!wireHandsWrapEl) return;
  wireHandsWrapEl.textContent = "";

  const pmap = state.players && typeof state.players === "object" ? state.players : {};
  const wireIds = Object.keys(pmap).sort((a, b) => Number(a) - Number(b));
  const byHex =
    state.logHandByColorHex && typeof state.logHandByColorHex === "object" ? state.logHandByColorHex : {};

  if (wireIds.length === 0) {
    const hexKeys = Object.keys(byHex);
    if (hexKeys.length === 0) {
      const ph = document.createElement("p");
      ph.className = "hint tiny";
      ph.textContent =
        "No seats yet from the game socket, and no feed totals. Open a match and scroll the activity feed.";
      wireHandsWrapEl.appendChild(ph);
      return;
    }
    const wtbl = document.createElement("table");
    wtbl.className = "data-table data-table--hands";
    wtbl.innerHTML = HANDS_TABLE_HEAD;
    const wtb = document.createElement("tbody");
    for (const hex of hexKeys.sort()) {
      const r = byHex[hex];
      const cid = colorIdFromColonistChatHex(hex);
      const label =
        cid != null
          ? escapeHtml(playerLabel(cid))
          : escapeHtml(`Feed ${hex}`);
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${label}</td><td class="col-num">${r.lumber ?? 0}</td><td class="col-num">${r.brick ?? 0}</td><td class="col-num">${r.wool ?? 0}</td><td class="col-num">${r.grain ?? 0}</td><td class="col-num">${r.ore ?? 0}</td><td class="col-num">${r.unknown ?? 0}</td>`;
      wtb.appendChild(tr);
    }
    wtbl.appendChild(wtb);
    wireHandsWrapEl.appendChild(wtbl);
    return;
  }

  const wtbl = document.createElement("table");
  wtbl.className = "data-table data-table--hands";
  wtbl.innerHTML = HANDS_TABLE_HEAD;
  const wtb = document.createElement("tbody");

  for (const id of wireIds) {
    const pl = pmap[id];
    const colorId = pl.colorId != null ? Number(pl.colorId) : Number(id);
    const r = feedHandRowForColorId(state, colorId);
    const label = `${escapeHtml(playerLabel(colorId))} <span class="muted">(#${escapeHtml(id)})</span>`;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${label}</td><td class="col-num">${r.lumber ?? 0}</td><td class="col-num">${r.brick ?? 0}</td><td class="col-num">${r.wool ?? 0}</td><td class="col-num">${r.grain ?? 0}</td><td class="col-num">${r.ore ?? 0}</td><td class="col-num">${r.unknown ?? 0}</td>`;
    wtb.appendChild(tr);
  }

  wtbl.appendChild(wtb);
  wireHandsWrapEl.appendChild(wtbl);
}

/** Latest raw buffer from storage (or paused snapshot while paused). */
let lastEventList = [];

/** Snapshot frozen when "Pause log" is enabled. */
let pausedCopy = null;

function setStatus(text) {
  statusEl.textContent = text;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatPieceCell(remaining, limit) {
  if (remaining == null || typeof remaining !== "number") return "—";
  const lim = limit > 0 ? limit : 0;
  const placed = lim > 0 ? Math.max(0, lim - remaining) : null;
  if (placed != null) {
    return `${placed} on board · ${remaining} left · max ${lim}`;
  }
  return `${remaining} left`;
}

function getRawEventList() {
  if (pauseEl.checked && pausedCopy) return pausedCopy;
  return lastEventList;
}

function eventMatchesQuery(ev, q) {
  if (!q) return true;
  try {
    const blob = `${ev.kind} ${JSON.stringify(ev.detail ?? {})}`.toLowerCase();
    return blob.includes(q);
  } catch {
    return String(ev.kind).toLowerCase().includes(q);
  }
}

function isHeartbeatNoise(ev) {
  if (isHeartbeatDecoded(ev?.detail?.decoded)) return true;
  if (ev.kind === "ws-send" && isLikelyWsSendPing(ev.detail)) return true;
  return false;
}

function isBinaryNoise(ev) {
  if (ev.kind !== "ws-message" && ev.kind !== "ws-send") return false;
  return isOpaqueBinaryWsDetail(ev?.detail);
}

function filterEvents(raw) {
  const q = logSearchEl.value.trim().toLowerCase();
  return raw.filter((ev) => {
    if (hideHeartbeatsEl.checked && isHeartbeatNoise(ev)) return false;
    if (hideBinaryWsEl?.checked && isBinaryNoise(ev)) return false;
    return eventMatchesQuery(ev, q);
  });
}

function renderLogFiltered() {
  const raw = getRawEventList();
  const filtered = filterEvents(raw);
  logEl.textContent = "";
  for (const payload of filtered.slice(0, MAX_ITEMS)) {
    logEl.appendChild(makeRow(payload));
  }
  const showing = Math.min(filtered.length, MAX_ITEMS);
  const narrowed =
    logSearchEl.value.trim() !== "" || hideHeartbeatsEl.checked || hideBinaryWsEl.checked;
  if (narrowed && filtered.length < raw.length) {
    setStatus(
      `${pauseEl.checked ? "Paused · " : ""}${showing} shown · ${filtered.length} match · ${raw.length} total`,
    );
  } else if (narrowed) {
    setStatus(
      `${pauseEl.checked ? "Paused · " : ""}${showing} shown · ${raw.length} total`,
    );
  } else {
    setStatus(pauseEl.checked ? `Paused (${raw.length} events buffered)` : `${raw.length} events in buffer`);
  }
}

function renderGameGlance(state) {
  gameGlanceGridEl.textContent = "";
  const cs = state.currentState || {};

  function addChip(label, value) {
    const wrap = document.createElement("div");
    wrap.className = "glance-chip";
    wrap.innerHTML = `<span class="glance-chip-label">${escapeHtml(label)}</span><span class="glance-chip-value">${escapeHtml(value)}</span>`;
    gameGlanceGridEl.appendChild(wrap);
  }

  if (cs.completedTurns != null) {
    addChip("Turns completed (wire)", String(cs.completedTurns));
    addChip("Human turn # (1-based)", String(Number(cs.completedTurns) + 1));
  }
  if (cs.currentTurnPlayerColor != null) {
    addChip("Current turn", playerLabel(cs.currentTurnPlayerColor));
  }
  if (cs.turnState != null || cs.actionState != null) {
    addChip("Turn / action", `t=${cs.turnState ?? "—"} · a=${cs.actionState ?? "—"}`);
  }
  if (cs.timeLeftInState != null) {
    addChip("Timer (s)", String(cs.timeLeftInState));
  }
  if (state.lastWireSequence != null) {
    addChip("Wire sequence", String(state.lastWireSequence));
  }
  if (state.robberTileIndex != null && typeof state.robberTileIndex === "number") {
    addChip("Robber tile", String(state.robberTileIndex));
  }
  const dh = state.diceHistory;
  if (Array.isArray(dh) && dh.length > 0) {
    const last = dh[dh.length - 1];
    addChip("Last roll", `${last.d1}+${last.d2}=${last.sum}`);
  }

  if (gameGlanceGridEl.childElementCount === 0) {
    const p = document.createElement("p");
    p.className = "hint tiny";
    p.style.margin = "0";
    p.textContent = "No snapshot yet — open an active game and wait for state diffs (type 91).";
    gameGlanceGridEl.appendChild(p);
  } else if (cs.completedTurns != null) {
    const note = document.createElement("p");
    note.className = "hint tiny glance-turn-note";
    note.textContent =
      "`completedTurns` is the server counter from `currentState` (full cycles on the wire, not every micro-action). The 1-based number is for quick reading only.";
    gameGlanceGridEl.appendChild(note);
  }
}

function formatTradeResponses(responses) {
  if (!responses || typeof responses !== "object") return "";
  const parts = Object.entries(responses)
    .map(([pid, code]) => `${playerLabel(Number(pid))}=${code}`)
    .join(", ");
  return parts ? `responses: ${parts}` : "";
}

function renderTradeWire(state) {
  if (!tradeWireWrapEl) return;
  tradeWireWrapEl.textContent = "";

  const hintDist = document.createElement("p");
  hintDist.className = "hint tiny trade-hint-dist";
  hintDist.textContent = DISTRIBUTION_TYPE_HINT;
  tradeWireWrapEl.appendChild(hintDist);

  const hProd = document.createElement("h3");
  hProd.className = "subh";
  hProd.textContent = "Last production (type 28)";
  tradeWireWrapEl.appendChild(hProd);

  const prod = state.lastProductionDistribution;
  if (!prod || !prod.summary) {
    const p = document.createElement("p");
    p.className = "hint tiny";
    p.textContent = "No production frame yet — appears on each roll’s resource grant list.";
    tradeWireWrapEl.appendChild(p);
  } else {
    const p = document.createElement("p");
    p.className = "trade-line";
    let line = prod.summary;
    if (Array.isArray(prod.distributionTypes) && prod.distributionTypes.length) {
      line += ` · dist types: ${prod.distributionTypes.join(", ")}`;
    }
    if (prod.sequence != null) line += ` · seq ${prod.sequence}`;
    p.textContent = line;
    tradeWireWrapEl.appendChild(p);
  }

  const m = state.tradeWireMirror && typeof state.tradeWireMirror === "object" ? state.tradeWireMirror : {};
  const active = m.activeOffers && typeof m.activeOffers === "object" ? m.activeOffers : {};

  const hAct = document.createElement("h3");
  hAct.className = "subh";
  hAct.textContent = "Open offers (tradeState.activeOffers)";
  tradeWireWrapEl.appendChild(hAct);

  const actives = Object.entries(active).filter(([, v]) => v && typeof v === "object");
  if (actives.length === 0) {
    const p = document.createElement("p");
    p.className = "hint tiny";
    p.textContent = "No active rows on the mirror — the wire clears slots with null when an offer closes.";
    tradeWireWrapEl.appendChild(p);
  } else {
    const ul = document.createElement("ul");
    ul.className = "trade-list";
    for (const [id, o] of actives) {
      const li = document.createElement("li");
      if (o.creator != null) {
        const off = formatResourceEnumList(o.offeredResources);
        const want = formatResourceEnumList(o.wantedResources);
        let line = `${id}: ${playerLabel(o.creator)} offers ${off || "—"} for ${want || "—"}`;
        const fr = formatTradeResponses(o.playerResponses);
        if (fr) line += ` · ${fr}`;
        li.textContent = line;
      } else {
        li.textContent = `${id}: (payload without creator — bank or special)`;
      }
      ul.appendChild(li);
    }
    tradeWireWrapEl.appendChild(ul);
  }

  const closed = m.closedOffers && typeof m.closedOffers === "object" ? m.closedOffers : {};
  const closedRows = Object.entries(closed).filter(([, v]) => v && typeof v === "object");
  const hCl = document.createElement("h3");
  hCl.className = "subh";
  hCl.textContent = "Closed offers (tradeState.closedOffers)";
  tradeWireWrapEl.appendChild(hCl);
  if (closedRows.length === 0) {
    const p = document.createElement("p");
    p.className = "hint tiny";
    p.textContent = "No closed-offer snapshots on the mirror yet.";
    tradeWireWrapEl.appendChild(p);
  } else {
    const ul = document.createElement("ul");
    ul.className = "trade-list trade-list--compact";
    for (const [id, o] of closedRows.slice(-8)) {
      const li = document.createElement("li");
      const off = formatResourceEnumList(o.offeredResources);
      const want = formatResourceEnumList(o.wantedResources);
      li.textContent = `${id}: gave ${off || "—"} · wanted ${want || "—"}`;
      ul.appendChild(li);
    }
    tradeWireWrapEl.appendChild(ul);
    if (closedRows.length > 8) {
      const more = document.createElement("p");
      more.className = "hint tiny";
      more.textContent = `…and ${closedRows.length - 8} older closed slot(s) in storage.`;
      tradeWireWrapEl.appendChild(more);
    }
  }

  if (state.tradeWireUpdatedAt != null) {
    const foot = document.createElement("p");
    foot.className = "hint tiny trade-meta";
    foot.textContent = `Trade mirror last updated: ${new Date(state.tradeWireUpdatedAt).toLocaleTimeString()}`;
    tradeWireWrapEl.appendChild(foot);
  }
}

function renderDiceHistory(state) {
  diceHistoryWrapEl.textContent = "";
  const hist = state.diceHistory;
  if (!Array.isArray(hist) || hist.length === 0) {
    const p = document.createElement("p");
    p.className = "hint tiny";
    p.style.margin = "0";
    p.textContent =
      "Rolls fill from type-91 diffs: we take the last diceState with diceThrown in each frame (gameLog type 10 is a fallback). Open a live game tab so the extension can decode WS traffic.";
    diceHistoryWrapEl.appendChild(p);
    return;
  }
  const slice = hist.slice(-16).reverse();
  for (const roll of slice) {
    const s = document.createElement("span");
    s.className = "dice-chip";
    s.textContent = `${roll.d1}+${roll.d2}=${roll.sum}`;
    diceHistoryWrapEl.appendChild(s);
  }
}

function renderVP(state) {
  vpWrapEl.textContent = "";
  const players = state.players && typeof state.players === "object" ? state.players : {};
  const ids = Object.keys(players).sort((a, c) => Number(a) - Number(c));
  const rows = ids.filter((id) => {
    const pl = players[id];
    return (
      pl.victoryPointsPublic != null ||
      pl.longestRoad != null ||
      pl.largestArmy != null
    );
  });
  if (rows.length === 0) {
    const p = document.createElement("p");
    p.className = "hint tiny";
    p.style.margin = "0";
    p.textContent = "VP and award markers show when included in player / mechanic state.";
    vpWrapEl.appendChild(p);
    return;
  }
  const tbl = document.createElement("table");
  tbl.className = "data-table";
  tbl.innerHTML =
    '<thead><tr><th scope="col">Player</th><th scope="col" class="col-num">VP (sum)</th><th scope="col" class="col-num">Longest road</th><th scope="col" class="col-num">Largest army</th></tr></thead>';
  const tb = document.createElement("tbody");
  for (const id of rows) {
    const pl = players[id];
    const tr = document.createElement("tr");
    const name = playerLabel(pl.colorId ?? Number(id));
    tr.innerHTML = `<td>${escapeHtml(name)} <span class="muted">(#${escapeHtml(id)})</span></td><td class="col-num">${pl.victoryPointsPublic ?? "—"}</td><td class="col-num">${pl.longestRoad ?? "—"}</td><td class="col-num">${pl.largestArmy ?? "—"}</td>`;
    tb.appendChild(tr);
  }
  tbl.appendChild(tb);
  vpWrapEl.appendChild(tbl);
}

function renderHeuristics(state) {
  heuristicsListEl.textContent = "";
  const tips = buildHeuristics(state);
  if (tips.length === 0) {
    const li = document.createElement("li");
    li.textContent = "Nothing notable from bank / hands right now.";
    heuristicsListEl.appendChild(li);
    return;
  }
  for (const t of tips) {
    const li = document.createElement("li");
    li.textContent = t;
    heuristicsListEl.appendChild(li);
  }
}

function renderUnknownKeys(state) {
  const keys = state.unknownDiffKeys;
  if (!Array.isArray(keys) || keys.length === 0) {
    unknownKeysSection.hidden = true;
    return;
  }
  unknownKeysSection.hidden = false;
  unknownKeysWrapEl.textContent = keys.join(", ");
}

function renderTracker(raw) {
  const state = raw && typeof raw === "object" ? raw : initialTrackerState();

  renderGameGlance(state);
  renderDiceHistory(state);
  renderTradeWire(state);
  renderVP(state);
  renderHeuristics(state);
  renderUnknownKeys(state);

  const b = state.bank || {};

  const parts = [];
  if (state.updatedAt != null) {
    parts.push(
      `Wire: ${new Date(state.updatedAt).toLocaleTimeString()} · ${state.rawMessageCount ?? 0} decoded frame(s)`,
    );
  } else {
    parts.push("Wire: waiting for game frames on this tab.");
  }
  if ((state.logEventCount ?? 0) > 0) {
    parts.push(
      `Log deltas: ${state.logEventCount} · ${state.logUpdatedAt != null ? new Date(state.logUpdatedAt).toLocaleTimeString() : ""}`,
    );
  }
  trackerMetaEl.textContent = parts.join(" · ");

  bankGridEl.textContent = "";
  const bankRows = [
    ["Lumber", b.lumber],
    ["Brick", b.brick],
    ["Wool", b.wool],
    ["Grain", b.grain],
    ["Ore", b.ore],
  ];
  if (typeof b.gold === "number" && b.gold > 0) bankRows.push(["Gold", b.gold]);
  for (const [label, val] of bankRows) {
    const cell = document.createElement("div");
    const slug = label.toLowerCase().replace(/\s+/g, "-");
    cell.className = `bank-cell bank-cell--${slug}`;
    cell.innerHTML = `<span class="bank-label">${escapeHtml(label)}</span><span class="bank-val">${escapeHtml(String(val ?? 0))}</span>`;
    bankGridEl.appendChild(cell);
  }
  const other = b.other && typeof b.other === "object" ? b.other : {};
  for (const k of Object.keys(other)) {
    if (!other[k]) continue;
    const cell = document.createElement("div");
    cell.className = "bank-cell bank-other";
    cell.innerHTML = `<span class="bank-label">Other (${escapeHtml(k)})</span><span class="bank-val">${escapeHtml(String(other[k]))}</span>`;
    bankGridEl.appendChild(cell);
  }

  renderUnifiedHands(state);

  devCardsEl.textContent = "";
  const deckCard = document.createElement("div");
  deckCard.className = "dev-deck-card";
  const remaining = state.devBankRemaining;
  if (typeof remaining === "number" && remaining >= 0) {
    const pct = Math.min(100, Math.round((remaining / BASE_GAME_DEV_DECK_TOTAL) * 100));
    const bar = document.createElement("div");
    bar.className = "dev-deck-bar";
    bar.setAttribute("role", "img");
    bar.setAttribute(
      "aria-label",
      `${remaining} development cards left in deck (reference total ${BASE_GAME_DEV_DECK_TOTAL})`,
    );
    const fill = document.createElement("div");
    fill.className = "dev-deck-bar-fill";
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);
    deckCard.appendChild(bar);
    const cap = document.createElement("p");
    cap.className = "dev-deck-caption";
    cap.innerHTML = `<strong>${remaining}</strong> left in deck <span class="muted">· ~${BASE_GAME_DEV_DECK_TOTAL} in base Catan</span>`;
    deckCard.appendChild(cap);
    const refLine = STANDARD_DEV_DECK_COMPOSITION.map((r) => `${r.count} ${r.label}`).join(" · ");
    const refP = document.createElement("p");
    refP.className = "hint tiny dev-deck-ref";
    refP.textContent = `Base deck makeup: ${refLine}.`;
    deckCard.appendChild(refP);
    const slots = state.devBankSlots;
    if (Array.isArray(slots) && slots.length > 0) {
      const freq = {};
      for (const x of slots) {
        const lab = devCardLabel(Number(x));
        freq[lab] = (freq[lab] || 0) + 1;
      }
      const parts = Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}×${v}`);
      const mix = document.createElement("p");
      mix.className = "hint tiny dev-deck-mix";
      mix.textContent = `Stack mix: ${parts.join(" · ")}`;
      deckCard.appendChild(mix);
    }
  } else {
    const p = document.createElement("p");
    p.className = "hint tiny";
    p.textContent =
      "Deck count appears when the wire sends mechanicDevelopmentCardsState.bankDevelopmentCards.";
    deckCard.appendChild(p);
    const refLine = STANDARD_DEV_DECK_COMPOSITION.map((r) => `${r.count} ${r.label}`).join(" · ");
    const refP = document.createElement("p");
    refP.className = "hint tiny dev-deck-ref";
    refP.textContent = `Base deck makeup: ${refLine}.`;
    deckCard.appendChild(refP);
  }
  devCardsEl.appendChild(deckCard);

  const playedWrap = document.createElement("div");
  playedWrap.className = "dev-played-section";
  const playedTitle = document.createElement("h3");
  playedTitle.className = "subh";
  playedTitle.textContent = "Played (wire totals)";
  playedWrap.appendChild(playedTitle);
  const dc = state.devCardsPlayed && typeof state.devCardsPlayed === "object" ? state.devCardsPlayed : {};
  const keys = Object.keys(dc).sort();
  if (keys.length === 0) {
    const p = document.createElement("p");
    p.className = "hint tiny";
    p.textContent = "No developmentCardsUsed entries yet.";
    playedWrap.appendChild(p);
  } else {
    const grid = document.createElement("div");
    grid.className = "dev-played-grid";
    for (const k of keys) {
      const chip = document.createElement("div");
      chip.className = "dev-stat-chip";
      chip.innerHTML = `<span class="dev-stat-name">${escapeHtml(k)}</span><span class="dev-stat-val">${escapeHtml(String(dc[k]))}</span>`;
      grid.appendChild(chip);
    }
    playedWrap.appendChild(grid);
  }
  devCardsEl.appendChild(playedWrap);

  const playersForDev = state.players && typeof state.players === "object" ? state.players : {};
  const devIds = Object.keys(playersForDev).sort((a, c) => Number(a) - Number(c));
  const anyDevByPlayer = devIds.some(
    (id) => Array.isArray(playersForDev[id].developmentCardsUsed) && playersForDev[id].developmentCardsUsed.length > 0,
  );
  if (anyDevByPlayer) {
    const sub = document.createElement("div");
    sub.className = "dev-by-player";
    const h = document.createElement("h3");
    h.className = "subh";
    h.textContent = "By player";
    sub.appendChild(h);
    const dl = document.createElement("dl");
    dl.className = "dev-dl";
    for (const id of devIds) {
      const pl = playersForDev[id];
      const used = pl.developmentCardsUsed;
      if (!Array.isArray(used) || used.length === 0) continue;
      const dt = document.createElement("dt");
      dt.textContent = `${playerLabel(pl.colorId ?? Number(id))} (#${id})`;
      const dd = document.createElement("dd");
      const devParts = Object.entries(summarizeDevUsed(used))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}: ${v}`);
      dd.textContent = devParts.join(" · ");
      dl.appendChild(dt);
      dl.appendChild(dd);
    }
    sub.appendChild(dl);
    devCardsEl.appendChild(sub);
  }

  piecesWrapEl.textContent = "";
  const players = state.players && typeof state.players === "object" ? state.players : {};
  const ids = Object.keys(players).sort((a, c) => Number(a) - Number(c));
  const anyShip = ids.some((id) => players[id].bankShipAmount != null);

  if (ids.length === 0) {
    const p = document.createElement("p");
    p.className = "hint tiny";
    p.textContent = "No per-player piece data yet — mechanic state arrives in socket diffs.";
    piecesWrapEl.appendChild(p);
  } else {
    const table = document.createElement("table");
    table.className = "data-table";
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    hr.innerHTML = `<th scope="col">Player</th><th scope="col">Roads</th><th scope="col">Settlements</th><th scope="col">Cities</th>${anyShip ? "<th scope=\"col\">Ships</th>" : ""}`;
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");

    for (const id of ids) {
      const pl = players[id];
      const tr = document.createElement("tr");
      const name = playerLabel(pl.colorId ?? Number(id));
      const label = `${escapeHtml(name)} <span class="muted">(#${escapeHtml(id)})</span>`;
      let html = `<td>${label}</td>`;
      html += `<td>${escapeHtml(formatPieceCell(pl.bankRoadAmount, DEFAULT_PIECE_LIMITS.road))}</td>`;
      html += `<td>${escapeHtml(formatPieceCell(pl.bankSettlementAmount, DEFAULT_PIECE_LIMITS.settlement))}</td>`;
      html += `<td>${escapeHtml(formatPieceCell(pl.bankCityAmount, DEFAULT_PIECE_LIMITS.city))}</td>`;
      if (anyShip) {
        html += `<td>${escapeHtml(formatPieceCell(pl.bankShipAmount, DEFAULT_PIECE_LIMITS.ship))}</td>`;
      }
      tr.innerHTML = html;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    piecesWrapEl.appendChild(table);
  }
}

function makeRow(payload) {
  const { kind, t, detail } = payload;
  const li = document.createElement("li");
  const kindClass =
    kind === "ws-send"
      ? "kind-send"
      : kind === "ws-message"
        ? "kind-message"
        : kind === "inject-ready" || kind === "ws-open"
          ? "kind-meta"
          : "";

  if (kindClass) li.classList.add(kindClass);

  const meta = document.createElement("span");
  meta.className = "meta";
  const time = new Date(t).toLocaleTimeString();
  const enc =
    detail && typeof detail.encoding === "string"
      ? ` · <span class="enc">${escapeHtml(detail.encoding)}</span>`
      : "";
  meta.innerHTML = `<strong>${escapeHtml(kind)}</strong>${enc} · ${time}`;

  const body = document.createElement("pre");
  body.style.margin = "0";
  body.style.whiteSpace = "pre-wrap";
  let bodyText =
    detail &&
    detail.rawPreview != null &&
    typeof detail.rawPreview === "string"
      ? detail.rawPreview
      : formatDetail(detail);
  if (kind === "inject-ready" && detail?.href) {
    bodyText = `${detail.href}\ntop-level frame: ${detail.isTopFrame !== false}`;
  }
  if (kind === "ws-open" && detail?.url) {
    bodyText = String(detail.url);
  }
  body.textContent = bodyText;

  li.appendChild(meta);
  li.appendChild(body);
  return li;
}

function formatDetail(detail) {
  if (detail == null) return "";
  try {
    return typeof detail === "string"
      ? detail
      : JSON.stringify(detail, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 0);
  } catch {
    return String(detail);
  }
}

function loadSession() {
  chrome.storage.session.get([SESSION_KEY, TRACKER_STORAGE_KEY], (data) => {
    lastEventList = Array.isArray(data[SESSION_KEY]) ? data[SESSION_KEY] : [];
    renderLogFiltered();
    renderTracker(data[TRACKER_STORAGE_KEY]);
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "session") return;

  if (changes[TRACKER_STORAGE_KEY]?.newValue != null) {
    renderTracker(changes[TRACKER_STORAGE_KEY].newValue);
  }

  if (!changes[SESSION_KEY]) return;
  if (pauseEl.checked) return;
  const next = changes[SESSION_KEY].newValue;
  if (Array.isArray(next)) {
    lastEventList = next;
    renderLogFiltered();
  }
});

pauseEl.addEventListener("change", () => {
  if (pauseEl.checked) {
    chrome.storage.session.get(SESSION_KEY, (data) => {
      pausedCopy = Array.isArray(data[SESSION_KEY]) ? [...data[SESSION_KEY]] : [];
      renderLogFiltered();
    });
  } else {
    pausedCopy = null;
    loadSession();
  }
});

clearEl.addEventListener("click", () => {
  chrome.storage.session.set(
    {
      [SESSION_KEY]: [],
      [TRACKER_STORAGE_KEY]: initialTrackerState(),
    },
    () => {
      pausedCopy = pauseEl.checked ? [] : null;
      lastEventList = [];
      logSearchEl.value = "";
      hideHeartbeatsEl.checked = true;
      hideBinaryWsEl.checked = true;
      logEl.textContent = "";
      renderTracker(initialTrackerState());
      renderLogFiltered();
      setStatus("Cleared");
    },
  );
});

logSearchEl.addEventListener("input", () => {
  renderLogFiltered();
});

hideHeartbeatsEl.addEventListener("change", () => {
  renderLogFiltered();
});

hideBinaryWsEl.addEventListener("change", () => {
  try {
    localStorage.setItem("colonistAnalystHideBinary", hideBinaryWsEl.checked ? "1" : "0");
  } catch {
    /* ignore */
  }
  renderLogFiltered();
});

exportJsonBtn.addEventListener("click", () => {
  const manifest = chrome.runtime.getManifest();
  chrome.storage.session.get([SESSION_KEY, TRACKER_STORAGE_KEY], (data) => {
    const bundle = {
      exportedAt: new Date().toISOString(),
      extensionVersion: manifest.version,
      trackerState: data[TRACKER_STORAGE_KEY] ?? initialTrackerState(),
      events: data[SESSION_KEY] ?? [],
    };
    const blob = new Blob(
      [
        JSON.stringify(bundle, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2),
      ],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `colonist-analyst-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
});

function initOnboard() {
  try {
    if (localStorage.getItem(ONBOARD_KEY) === "1") {
      onboardBanner.hidden = true;
      return;
    }
  } catch {
    /* ignore */
  }
  onboardBanner.hidden = false;
}

onboardDismiss.addEventListener("click", () => {
  try {
    localStorage.setItem(ONBOARD_KEY, "1");
  } catch {
    /* ignore */
  }
  onboardBanner.hidden = true;
});

initOnboard();
try {
  if (localStorage.getItem("colonistAnalystHideBinary") === "0") {
    hideBinaryWsEl.checked = false;
  }
} catch {
  /* ignore */
}
loadSession();
setStatus("Open a colonist.io game tab; events fill the buffer.");
