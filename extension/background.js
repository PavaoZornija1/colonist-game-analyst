/**
 * Opens the analyst side panel when the user clicks the extension icon on a Colonist tab.
 * Relays page events to `chrome.storage.session` so the side panel can subscribe reliably
 * (MV3 content scripts cannot message the side panel directly).
 * Maintains merged `colonistTrackerState` from WebSocket (JSON/MessagePack) + optional game log deltas.
 */
import {
  TRACKER_STORAGE_KEY,
  initialTrackerState,
  applyAnalystPayload,
  applyGameLogDelta,
  normalizeColonistChatHex,
} from "./colonist-tracker.js";

const SESSION_KEY = "colonistAnalystEvents";
const MAX_EVENTS = 400;

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {
    /* ignore if API unavailable */
  });

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({
    path: "sidepanel.html",
    enabled: true,
  });
});

function cloneTracker(raw) {
  if (!raw || typeof raw !== "object") return initialTrackerState();
  try {
    if (typeof structuredClone === "function") {
      return structuredClone(raw);
    }
  } catch {
    /* fall through */
  }
  try {
    return JSON.parse(
      JSON.stringify(raw, (_k, v) => (typeof v === "bigint" ? Number(v) : v)),
    );
  } catch {
    return initialTrackerState();
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "ANALYST_PAGE_EVENT" || !msg.payload) {
    return;
  }

  chrome.storage.session.get([SESSION_KEY, TRACKER_STORAGE_KEY], (data) => {
    try {
      const p = msg.payload;
      const isWs = p.kind === "ws-message" || p.kind === "ws-send";
      const isLog = p.kind === "game-log" || p.kind === "game-log-meta";
      const showInPanel = isWs || p.kind === "inject-ready" || p.kind === "ws-open";

      const list = Array.isArray(data[SESSION_KEY]) ? data[SESSION_KEY] : [];
      const next = showInPanel ? [p, ...list].slice(0, MAX_EVENTS) : list;

      const tracker = cloneTracker(data[TRACKER_STORAGE_KEY]);
      if (isLog && p.detail && typeof p.detail === "object") {
        if (p.detail.setLocalDisplayName && typeof p.detail.player === "string") {
          const n = p.detail.player.trim();
          if (n) tracker.logLocalPlayerDisplayName = n;
          if (typeof p.detail.colorHex === "string" && p.detail.colorHex.trim()) {
            const hx = normalizeColonistChatHex(p.detail.colorHex);
            if (hx) tracker.logLocalPlayerColorHex = hx;
          }
        }
        const cards = p.detail.cards;
        if (cards && typeof cards === "object") {
          const sum =
            Math.abs(Number(cards.lumber) || 0) +
            Math.abs(Number(cards.brick) || 0) +
            Math.abs(Number(cards.wool) || 0) +
            Math.abs(Number(cards.grain) || 0) +
            Math.abs(Number(cards.ore) || 0) +
            Math.abs(Number(cards.unknown) || 0);
          if (sum > 0 && (p.detail.colorHex || p.detail.targetYou)) {
            applyGameLogDelta(tracker, {
              colorHex: p.detail.colorHex,
              targetYou: p.detail.targetYou === true,
              cards,
            });
          }
        }
      } else if (isWs) {
        applyAnalystPayload(tracker, p);
      }

      chrome.storage.session.set({
        [SESSION_KEY]: next,
        [TRACKER_STORAGE_KEY]: tracker,
      });
    } catch (e) {
      console.warn("[Colonist analyst] ANALYST_PAGE_EVENT handler:", e?.message || e);
    }
  });
});
