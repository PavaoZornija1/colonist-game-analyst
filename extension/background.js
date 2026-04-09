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
  inferDefiniteLocalWireColorId,
} from "./colonist-tracker.js";

const SESSION_KEY = "colonistAnalystEvents";
const HANDS_LOG_SESSION_KEY = "colonistAnalystHandsLogEvents";
const MAX_EVENTS = 400;
const MAX_HANDS_LOG_EVENTS = 2000;

const COLONIST_URL_RE = /^https:\/\/([a-z0-9-]+\.)?(colonist|hexs)\.io\//i;

function isColonistUrl(url) {
  return typeof url === "string" && COLONIST_URL_RE.test(url);
}

async function ensureHooksOnTab(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content.js"],
    });
  } catch {
    /* ignore (restricted frame / not ready) */
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      files: ["msgpack.min.js", "injected.js"],
    });
  } catch {
    /* ignore */
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["game-log.js"],
    });
  } catch {
    /* ignore */
  }
}

async function ensureHooksOnOpenColonistTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab?.id != null && isColonistUrl(tab.url)) {
        await ensureHooksOnTab(tab.id);
      }
    }
  } catch {
    /* ignore */
  }
}

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
  void ensureHooksOnOpenColonistTabs();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureHooksOnOpenColonistTabs();
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "complete") return;
  if (!isColonistUrl(tab?.url)) return;
  void ensureHooksOnTab(tabId);
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

/**
 * Serialize session updates. Concurrent WS frames + game-log events used to race:
 * each handler did get → clone → merge → set, and a slow WS write could overwrite
 * a newer logHandByColorHex / hands log from game-log (HANDS stayed 0, lines missing).
 */
let sessionWriteChain = Promise.resolve();

function enqueueSessionWrite(task) {
  sessionWriteChain = sessionWriteChain
    .then(task)
    .catch((e) => {
      console.warn("[Colonist analyst] session write queue:", e?.message || e);
    });
  return sessionWriteChain;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "ANALYST_PAGE_EVENT" || !msg.payload) {
    return;
  }

  const p = msg.payload;
  void enqueueSessionWrite(async () => {
    const data = await chrome.storage.session.get([
      SESSION_KEY,
      TRACKER_STORAGE_KEY,
      HANDS_LOG_SESSION_KEY,
    ]);

    const isWs = p.kind === "ws-message" || p.kind === "ws-send";
    const isLog =
      p.kind === "game-log" || p.kind === "game-log-meta" || p.kind === "game-log-line";
    const showInPanel = isWs || isLog || p.kind === "inject-ready" || p.kind === "ws-open";
    const isHandsLogLine = p.kind === "game-log-line" || p.kind === "game-log";

    const list = Array.isArray(data[SESSION_KEY]) ? data[SESSION_KEY] : [];
    const next = showInPanel ? [p, ...list].slice(0, MAX_EVENTS) : list;
    const handsLogList = Array.isArray(data[HANDS_LOG_SESSION_KEY])
      ? data[HANDS_LOG_SESSION_KEY]
      : [];
    const nextHandsLog = isHandsLogLine
      ? [p, ...handsLogList].slice(0, MAX_HANDS_LOG_EVENTS)
      : handsLogList;

    const tracker = cloneTracker(data[TRACKER_STORAGE_KEY]);
    if (isLog && p.detail && typeof p.detail === "object") {
      if (p.detail.resetMatch === true) {
        const fresh = initialTrackerState();
        await chrome.storage.session.set({
          [SESSION_KEY]: next,
          [HANDS_LOG_SESSION_KEY]: [],
          [TRACKER_STORAGE_KEY]: fresh,
        });
        return;
      }
      if (p.detail.setLocalDisplayName && typeof p.detail.player === "string") {
        const n = p.detail.player.trim();
        if (n) tracker.logLocalPlayerDisplayName = n;
        if (typeof p.detail.colorHex === "string" && p.detail.colorHex.trim()) {
          const hx = normalizeColonistChatHex(p.detail.colorHex);
          if (hx) {
            tracker.logLocalPlayerColorHex = hx;
            const localCid = Number.isFinite(Number(tracker.localWireColorId))
              ? Number(tracker.localWireColorId)
              : inferDefiniteLocalWireColorId(tracker);
            if (localCid != null) {
              if (!tracker.feedHexByColorId || typeof tracker.feedHexByColorId !== "object") {
                tracker.feedHexByColorId = {};
              }
              const k = String(localCid);
              const prev = normalizeColonistChatHex(tracker.feedHexByColorId[k]);
              if (!prev || prev === hx) {
                tracker.feedHexByColorId[k] = hx;
              }
            }
          }
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
            player: typeof p.detail.player === "string" ? p.detail.player : undefined,
            cards,
          });
        }
      }
    } else if (isWs) {
      applyAnalystPayload(tracker, p);
    }

    await chrome.storage.session.set({
      [SESSION_KEY]: next,
      [HANDS_LOG_SESSION_KEY]: nextHandsLog,
      [TRACKER_STORAGE_KEY]: tracker,
    });
  });
});
