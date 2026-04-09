import test from "node:test";
import assert from "node:assert/strict";
import {
  initialTrackerState,
  normalizeColonistChatHex,
  applyGameLogDelta,
  applyParsedMessage,
  resolveFeedHexForColorId,
  feedHandRowForColorId,
  inferDefiniteLocalWireColorId,
} from "../extension/colonist-tracker.js";

test("normalizeColonistChatHex normalizes shorthand and casing", () => {
  assert.equal(normalizeColonistChatHex("#E27174"), "#e27174");
  assert.equal(normalizeColonistChatHex("E27"), "#ee2277");
  assert.equal(normalizeColonistChatHex("zzzzzz"), "");
});

test("applyGameLogDelta stores and sums by feed hex", () => {
  const state = initialTrackerState();
  applyGameLogDelta(state, {
    colorHex: "#223697",
    player: "Chari",
    cards: { grain: 1 },
  });
  applyGameLogDelta(state, {
    colorHex: "#223697",
    cards: { grain: 2, brick: 1 },
  });
  const row = state.logHandByColorHex["#223697"];
  assert.equal(row.grain, 3);
  assert.equal(row.brick, 1);
  assert.equal(state.feedNameByHex["#223697"], "Chari");
});

test("resolveFeedHexForColorId uses runtime mapping when available", () => {
  const state = initialTrackerState();
  assert.equal(resolveFeedHexForColorId(state, 1), "#e27174");
  state.feedHexByColorId["1"] = "#e27174";
  assert.equal(resolveFeedHexForColorId(state, 1), "#e27174");
});

test("resolveFeedHexForColorId swaps local seat dynamically per match", () => {
  const state = initialTrackerState();
  state.localWireColorId = 1;
  state.logLocalPlayerColorHex = "#e27174";
  assert.equal(resolveFeedHexForColorId(state, 1), "#e27174");
  assert.equal(resolveFeedHexForColorId(state, 2), "#223697");
});

test("feedHandRowForColorId uses resolved mapping", () => {
  const state = initialTrackerState();
  state.feedHexByColorId["1"] = "#e27174";
  state.logHandByColorHex["#e27174"] = {
    lumber: 0,
    brick: 2,
    wool: 0,
    grain: 1,
    ore: 0,
    unknown: 0,
  };
  const row = feedHandRowForColorId(state, 1);
  assert.equal(row.brick, 2);
  assert.equal(row.grain, 1);
});

test("inferDefiniteLocalWireColorId requires exactly one typed seat", () => {
  const state = initialTrackerState();
  assert.equal(inferDefiniteLocalWireColorId(state), null);
  state.players["1"] = {
    colorId: 1,
    wireHandAllZeros: false,
    wireResources: { lumber: 1, brick: 0, wool: 0, grain: 0, ore: 0 },
  };
  assert.equal(inferDefiniteLocalWireColorId(state), 1);
  state.players["2"] = {
    colorId: 2,
    wireHandAllZeros: false,
    wireResources: { lumber: 0, brick: 1, wool: 0, grain: 0, ore: 0 },
  };
  assert.equal(inferDefiniteLocalWireColorId(state), null);
});

test("applyParsedMessage locks local wire color id after first type-4", () => {
  const state = initialTrackerState();
  applyParsedMessage(state, { data: { type: 4, payload: { playerColor: 1 } } });
  assert.equal(state.localWireColorId, 1);
  assert.equal(state.localWireColorIdLocked, true);
  applyParsedMessage(state, { data: { type: 4, payload: { playerColor: 2 } } });
  assert.equal(state.localWireColorId, 1);
});
