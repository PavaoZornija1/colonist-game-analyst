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
  reconcileUnknownFromTypedDeficits,
  feedVpAwardsRawTotal,
  feedVpAwardsForDisplayColumn,
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

test("applyGameLogDelta coerces numeric strings and targetYou uses feedHexByColorId fallback", () => {
  const state = initialTrackerState();
  state.localWireColorId = 1;
  state.feedHexByColorId["1"] = "#e27174";
  applyGameLogDelta(state, {
    targetYou: true,
    player: "You",
    cards: { wool: "1", grain: 2 },
  });
  const row = state.logHandByColorHex["#e27174"];
  assert.equal(row.wool, 1);
  assert.equal(row.grain, 2);
});

test("applyGameLogDelta targetYou uses display name → feedNameByHex when chat hex missing", () => {
  const state = initialTrackerState();
  state.logLocalPlayerDisplayName = "PavaoZ";
  state.feedNameByHex["#e27174"] = "PavaoZ";
  applyGameLogDelta(state, { targetYou: true, cards: { grain: 1 } });
  assert.equal(state.logHandByColorHex["#e27174"].grain, 1);
});

test("applyGameLogDelta targetYou infers hex from sole visible wire hand", () => {
  const state = initialTrackerState();
  state.players["1"] = {
    colorId: 1,
    wireHandAllZeros: false,
    wireResources: { lumber: 1, brick: 0, wool: 0, grain: 0, ore: 0 },
  };
  applyGameLogDelta(state, { targetYou: true, cards: { grain: 1 } });
  assert.equal(state.logHandByColorHex["#e27174"].grain, 1);
});

test("applyGameLogDelta targetYou infers hex with 0-based player keys", () => {
  const state = initialTrackerState();
  state.players["0"] = {
    colorId: 0,
    wireHandAllZeros: false,
    wireResources: { lumber: 1, brick: 0, wool: 0, grain: 0, ore: 0 },
  };
  applyGameLogDelta(state, { targetYou: true, cards: { grain: 1 } });
  assert.equal(state.logHandByColorHex["#e27174"].grain, 1);
});

test("applyGameLogDelta targetYou falls back to resolveFeedHexForColorId (seat swap)", () => {
  const state = initialTrackerState();
  state.localWireColorId = 2;
  state.logLocalPlayerColorHex = "#e27174";
  state.players["1"] = { colorId: 1 };
  state.players["2"] = { colorId: 2 };
  applyGameLogDelta(state, { targetYou: true, cards: { wool: 1 } });
  assert.equal(state.logHandByColorHex["#e27174"].wool, 1);
});

test("applyGameLogDelta resolves victim row by player when colorHex missing", () => {
  const state = initialTrackerState();
  state.feedNameByHex["#223697"] = "Jerome";
  applyGameLogDelta(state, { player: "Jerome", cards: { grain: -1 } });
  assert.equal(state.logHandByColorHex["#223697"].grain, -1);
});

test("reconcileUnknownFromTypedDeficits resolves one hidden card (city + steal pattern)", () => {
  const row = {
    lumber: 0,
    brick: 0,
    wool: 0,
    grain: 2,
    ore: 2,
    unknown: 1,
  };
  row.grain -= 2;
  row.ore -= 3;
  reconcileUnknownFromTypedDeficits(row);
  assert.equal(row.grain, 0);
  assert.equal(row.ore, 0);
  assert.equal(row.unknown, 0);
});

test("reconcileUnknownFromTypedDeficits resolves settlement missing wool", () => {
  const row = {
    lumber: 1,
    brick: 1,
    wool: 0,
    grain: 1,
    ore: 0,
    unknown: 1,
  };
  for (const k of ["lumber", "brick", "wool", "grain"])
    row[k] -= 1;
  reconcileUnknownFromTypedDeficits(row);
  assert.equal(row.lumber, 0);
  assert.equal(row.brick, 0);
  assert.equal(row.wool, 0);
  assert.equal(row.grain, 0);
  assert.equal(row.unknown, 0);
});

test("reconcileUnknownFromTypedDeficits does not infer when typed spend is already covered", () => {
  const row = {
    lumber: 1,
    brick: 1,
    wool: 0,
    grain: 0,
    ore: 0,
    unknown: 1,
  };
  row.lumber -= 1;
  row.brick -= 1;
  reconcileUnknownFromTypedDeficits(row);
  assert.equal(row.lumber, 0);
  assert.equal(row.brick, 0);
  assert.equal(row.unknown, 1);
});

test("reconcileUnknownFromTypedDeficits skips when not enough unknown", () => {
  const row = {
    lumber: 0,
    brick: 0,
    wool: 0,
    grain: 0,
    ore: 0,
    unknown: 1,
  };
  row.lumber -= 1;
  row.brick -= 1;
  reconcileUnknownFromTypedDeficits(row);
  assert.equal(row.lumber, -1);
  assert.equal(row.brick, -1);
  assert.equal(row.unknown, 1);
});

test("applyGameLogDelta runs reconciliation after spend", () => {
  const state = initialTrackerState();
  applyGameLogDelta(state, {
    colorHex: "#223697",
    cards: { grain: 2, ore: 2, unknown: 1 },
  });
  applyGameLogDelta(state, {
    colorHex: "#223697",
    cards: { grain: -2, ore: -3 },
  });
  const row = state.logHandByColorHex["#223697"];
  assert.equal(row.grain, 0);
  assert.equal(row.ore, 0);
  assert.equal(row.unknown, 0);
});

test("multi-unknown same resource (two ore from two steals)", () => {
  const row = {
    lumber: 0,
    brick: 0,
    wool: 0,
    grain: 0,
    ore: 1,
    unknown: 2,
  };
  row.ore -= 3;
  reconcileUnknownFromTypedDeficits(row);
  assert.equal(row.ore, 0);
  assert.equal(row.unknown, 0);
});

test("resolveFeedHexForColorId uses runtime mapping when available", () => {
  const state = initialTrackerState();
  assert.equal(resolveFeedHexForColorId(state, 1), "#e27174");
  state.feedHexByColorId["1"] = "#e27174";
  assert.equal(resolveFeedHexForColorId(state, 1), "#e27174");
});

test("resolveFeedHexForColorId no swap when wire seat matches chat palette", () => {
  const state = initialTrackerState();
  state.localWireColorId = 1;
  state.logLocalPlayerColorHex = "#e27174";
  assert.equal(resolveFeedHexForColorId(state, 1), "#e27174");
  assert.equal(resolveFeedHexForColorId(state, 2), "#223697");
});

test("resolveFeedHexForColorId swaps when local wire seat ≠ chat palette slot", () => {
  const state = initialTrackerState();
  state.localWireColorId = 2;
  state.logLocalPlayerColorHex = "#e27174";
  assert.equal(resolveFeedHexForColorId(state, 2), "#e27174");
  assert.equal(resolveFeedHexForColorId(state, 1), "#223697");
});

test("resolveFeedHexForColorId handles 0-based playerStates keys", () => {
  const state = initialTrackerState();
  state.players["0"] = { colorId: 0 };
  state.players["1"] = { colorId: 1 };
  state.localWireColorId = 0;
  state.logLocalPlayerColorHex = "#e27174";
  assert.equal(resolveFeedHexForColorId(state, 0), "#e27174");
  assert.equal(resolveFeedHexForColorId(state, 1), "#223697");
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

test("victoryPointsState partial wire patches merge (city/settlement components)", () => {
  const state = initialTrackerState();
  applyParsedMessage(state, {
    data: {
      payload: {
        diff: { playerStates: { "1": { victoryPointsState: { "4": 1 } } } },
      },
    },
  });
  assert.equal(state.players["1"].victoryPointsPublic, 1);
  applyParsedMessage(state, {
    data: {
      payload: {
        diff: { playerStates: { "1": { victoryPointsState: { "3": 2 } } } },
      },
    },
  });
  assert.equal(state.players["1"].victoryPointsPublic, 3);
  assert.deepEqual(state.players["1"].victoryPointsState, { "3": 2, "4": 1 });
});

test("feedVpAwardsForDisplayColumn keeps feed LR when wire VP matches merged (undercount)", () => {
  const pl = {
    victoryPointsPublic: 3,
    victoryPointsState: { "4": 1, "3": 2 },
    hasLongestRoad: true,
    feedLongestRoadVp: 2,
  };
  assert.equal(feedVpAwardsRawTotal(pl), 2);
  assert.equal(feedVpAwardsForDisplayColumn(pl), 2);
});

test("feedVpAwardsForDisplayColumn drops feed LR when public exceeds merged sum", () => {
  const pl = {
    victoryPointsPublic: 5,
    victoryPointsState: { "4": 1, "3": 2 },
    hasLongestRoad: true,
    feedLongestRoadVp: 2,
  };
  assert.equal(feedVpAwardsForDisplayColumn(pl), 0);
});

test("feedVpAwardsForDisplayColumn drops feed LR when merged has many keys (wire complete)", () => {
  const pl = {
    victoryPointsPublic: 5,
    victoryPointsState: { a: 1, b: 2, c: 2 },
    hasLongestRoad: true,
    feedLongestRoadVp: 2,
  };
  assert.equal(feedVpAwardsForDisplayColumn(pl), 0);
});
