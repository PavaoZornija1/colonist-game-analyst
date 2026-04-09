/**
 * Isolated-world bridge: forwards MAIN-world postMessage events from injected.js
 * to the background worker. WebSocket hook + msgpack load in MAIN world via
 * manifest.json ("world": "MAIN") so page CSP never sees inline script.
 */
(function colonistAnalystContent() {
  "use strict";

  const MESSAGE_SOURCE = "colonist-game-analyst";

  /**
   * After you reload the extension in chrome://extensions, already-open tabs still run the old
   * content script; chrome.runtime is disconnected → "Extension context invalidated".
   * Refresh the colonist.io tab to load a fresh script. We no-op quietly here.
   */
  function sendAnalystEvent(payload) {
    try {
      if (!chrome.runtime?.id) return;
      chrome.runtime
        .sendMessage({ type: "ANALYST_PAGE_EVENT", payload })
        .catch((err) => {
          const msg = err?.message || String(err);
          if (msg.includes("Extension context invalidated")) return;
          console.warn("[Colonist analyst] sendMessage failed:", msg);
        });
    } catch (e) {
      const msg = e?.message || String(e);
      if (msg.includes("Extension context invalidated")) return;
      console.warn("[Colonist analyst] sendMessage failed:", msg);
    }
  }

  window.addEventListener(
    "message",
    (event) => {
      if (event.source !== window) return;
      const d = event.data;
      if (!d || d.source !== MESSAGE_SOURCE) return;
      sendAnalystEvent(d);
    },
    false,
  );
})();
