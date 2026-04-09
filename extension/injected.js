/**
 * Runs in the page MAIN world. Hooks WebSocket; decodes JSON / MessagePack / binary previews.
 * Depends on msgpack.min.js exposing global MessagePack (manifest lists msgpack before this file).
 */
(function colonistAnalystInjected() {
  const SOURCE = "colonist-game-analyst";

  function emit(kind, detail) {
    window.postMessage(
      {
        source: SOURCE,
        t: Date.now(),
        kind,
        detail,
      },
      "*",
    );
  }

  function safeJsonPreview(obj, max) {
    try {
      const s = JSON.stringify(obj, (_k, v) =>
        typeof v === "bigint" ? v.toString() : v,
      );
      return s.length > max ? s.slice(0, max) + "…" : s;
    } catch {
      return String(obj).slice(0, max);
    }
  }

  function tryDecodeBytes(u8) {
    if (!u8 || u8.byteLength === 0) {
      return { encoding: "empty", decoded: null, rawPreview: "" };
    }

    const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(u8);
    const trimmed = utf8.trim();
    if (
      (trimmed.startsWith("{") || trimmed.startsWith("[")) &&
      trimmed.length < 512 * 1024
    ) {
      try {
        const decoded = JSON.parse(trimmed);
        return {
          encoding: "json",
          decoded,
          rawPreview:
            trimmed.length > 4000 ? trimmed.slice(0, 4000) + "…" : trimmed,
        };
      } catch {
        /* fall through */
      }
    }

    if (typeof MessagePack !== "undefined" && MessagePack.decode) {
      try {
        const decoded = MessagePack.decode(u8);
        return {
          encoding: "msgpack",
          decoded,
          rawPreview: safeJsonPreview(decoded, 4000),
        };
      } catch {
        /* fall through */
      }
    }

    const hex = Array.from(u8.slice(0, 48))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ");
    return {
      encoding: "binary",
      decoded: null,
      rawPreview: `opaque ${u8.byteLength} B: ${hex}${u8.byteLength > 48 ? "…" : ""}`,
    };
  }

  async function normalizeWsPayload(data) {
    if (data == null) {
      return { encoding: "empty", decoded: null, rawPreview: "" };
    }

    if (typeof data === "string") {
      const t = data.trim();
      if (!t) {
        return { encoding: "empty", decoded: null, rawPreview: "" };
      }
      if (t.startsWith("{") || t.startsWith("[")) {
        try {
          return {
            encoding: "json",
            decoded: JSON.parse(t),
            rawPreview: t.length > 4000 ? t.slice(0, 4000) + "…" : t,
          };
        } catch {
          return {
            encoding: "string",
            decoded: null,
            rawPreview: t.length > 4000 ? t.slice(0, 4000) + "…" : t,
          };
        }
      }
      return {
        encoding: "string",
        decoded: null,
        rawPreview: t.length > 4000 ? t.slice(0, 4000) + "…" : t,
      };
    }

    if (data instanceof ArrayBuffer) {
      return tryDecodeBytes(new Uint8Array(data));
    }

    if (ArrayBuffer.isView(data)) {
      return tryDecodeBytes(
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      );
    }

    if (typeof Blob !== "undefined" && data instanceof Blob) {
      const ab = await data.arrayBuffer();
      return tryDecodeBytes(new Uint8Array(ab));
    }

    return {
      encoding: "string",
      decoded: null,
      rawPreview: String(data).slice(0, 4000),
    };
  }

  if (window.__colonistAnalystWsPatched) return;
  window.__colonistAnalystWsPatched = true;

  const Original = window.WebSocket;

  function patchInstance(ws, url) {
    ws.addEventListener("message", (ev) => {
      void normalizeWsPayload(ev.data).then((norm) => {
        emit("ws-message", { url: String(url), ...norm });
      });
    });

    const send = ws.send.bind(ws);
    ws.send = function patchedSend(data) {
      void normalizeWsPayload(data).then((norm) => {
        emit("ws-send", { url: String(url), ...norm });
      });
      return send(data);
    };

    emit("ws-open", { url: String(url) });
  }

  function ColonistAnalystWebSocket(url, protocols) {
    const ws =
      protocols !== undefined
        ? Reflect.construct(Original, [url, protocols], ColonistAnalystWebSocket)
        : Reflect.construct(Original, [url], ColonistAnalystWebSocket);

    patchInstance(ws, String(url));
    return ws;
  }

  ColonistAnalystWebSocket.prototype = Original.prototype;
  Object.setPrototypeOf(ColonistAnalystWebSocket, Original);

  window.WebSocket = ColonistAnalystWebSocket;
  if (typeof globalThis !== "undefined") {
    globalThis.WebSocket = ColonistAnalystWebSocket;
  }

  emit("inject-ready", {
    href: typeof location !== "undefined" ? location.href : "",
    isTopFrame: typeof window !== "undefined" && window === window.top,
  });
})();
