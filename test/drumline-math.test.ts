import { test } from "node:test";
import assert from "node:assert/strict";
import { bandPos, bump, centreAt, centres, drumlineLook, DRUMLINE_PRESETS, pad, readout, scalesAt, stripOptions, tickAt, wheelDelta } from "../src/drumline-math.ts";

test("bump is 1 at the focus and fades smoothly to 0 by its reach", () => {
  assert.equal(bump(0), 1);
  assert.equal(bump(1), 0);
  assert.equal(bump(0.5), 0.5);
  assert.ok(bump(1, 3) > 0.5 && bump(3, 3) === 0);
});

test("growing pictures push their neighbours aside instead of covering them", () => {
  const even = centres([1, 1, 1], 100, 10);
  assert.deepEqual(even, [50, 160, 270]);
  const grown = centres([1, 2, 1], 100, 10);
  assert.deepEqual(grown, [50, 210, 370]); // the middle one is 200 wide, gaps stay 10
  assert.equal(centreAt(even, 1.5), 215);
  assert.equal(centreAt(even, 9), 270);
});

test("scalesAt grows the focus and leaves the far pictures at 1", () => {
  const s = scalesAt(5, 2, 1.5);
  assert.equal(s[2], 1.5);
  assert.equal(s[0], 1);
  assert.equal(s[4], 1);
});

test("wheelDelta: both axes take the larger, one axis only that one, lines count as 16 px", () => {
  assert.equal(wheelDelta(3, 40, 0, "both"), 40);
  assert.equal(wheelDelta(-50, 10, 0, "both"), -50);
  assert.equal(wheelDelta(50, 10, 0, "y"), 10);
  assert.equal(wheelDelta(50, 10, 0, "x"), 50);
  assert.equal(wheelDelta(0, 3, 1, "both"), 48);
  assert.equal(wheelDelta(50, 10, 0, false), 0);
});

test("bandPos resists past the ends and never runs away", () => {
  assert.equal(bandPos(3, 10), 3);
  assert.ok(bandPos(-2, 10) < 0 && bandPos(-2, 10) > -2);
  assert.ok(bandPos(12, 10) > 9 && bandPos(12, 10) < 12);
});

test("readout, pad and tickAt", () => {
  assert.deepEqual(readout(0, 30), { prev: null, cur: 1, next: 2 });
  assert.deepEqual(readout(28, 30), { prev: 28, cur: 29, next: 30 });
  assert.deepEqual(readout(29, 30), { prev: 29, cur: 30, next: null });
  assert.equal(pad(7, 2), "07");
  assert.equal(tickAt(0, 200, 11), 0);
  assert.equal(tickAt(100, 200, 11), 5);
  assert.equal(tickAt(400, 200, 11), 10);
});

test("presets set every look option, and your options win", () => {
  for (const p of Object.values(DRUMLINE_PRESETS)) assert.equal(Object.keys(p).length, 8);
  assert.equal(drumlineLook({}).fluid, "bend");
  assert.equal(drumlineLook({ preset: "numbers" }).numbers, "frame");
  assert.equal(drumlineLook({ preset: "minimal", fluid: "off", ticks: true }).fluid, "off");
  assert.equal(drumlineLook({ preset: "minimal", fluid: "off", ticks: true }).ticks, true);
  assert.equal(drumlineLook({ preset: "minimal" }).look, "stories");
});

test("stripOptions: true, a name or options; nothing means no strip", () => {
  assert.equal(stripOptions(undefined), null);
  assert.equal(stripOptions(false), null);
  assert.deepEqual(stripOptions(true), { preset: "ruler" });
  assert.deepEqual(stripOptions("drumline"), { preset: "ruler" });
  assert.deepEqual(stripOptions("minimal"), { preset: "minimal" });
  assert.deepEqual(stripOptions({ preset: "numbers", fluid: "off" } as never), { preset: "numbers", fluid: "off" });
});
