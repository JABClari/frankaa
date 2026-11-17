import { test } from "node:test";
import assert from "node:assert/strict";
import { bandPos, bump, centreAt, centres, drumlineLook, DRUMLINE_PRESETS, lerpStep, LERP_RATE, pad, readout, releaseTarget, scalesAt, stripLayout, stripOptions, tickAt, tickLift, wheelDelta } from "../src/drumline-math.ts";

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

test("stripLayout centres the focus and grows it, the others pushed aside", () => {
  const { x, s } = stripLayout(5, 2, 1.5, 60, 10, 400);
  assert.equal(s[2], 1.5);
  assert.equal(x[2] + 60 / 2, 200); // the focus card's centre is the viewport's centre
  assert.ok(x[1] < x[2] && x[2] < x[3]);
  // Between two pictures the position moves smoothly.
  const a = stripLayout(5, 1, 1.5, 60, 10, 400).x[0], b = stripLayout(5, 1.5, 1.5, 60, 10, 400).x[0], c = stripLayout(5, 2, 1.5, 60, 10, 400).x[0];
  assert.ok(a > b && b > c);
  // Past the ends the strip moves on 1:1 with the position.
  const end = stripLayout(5, 4, 1.5, 60, 10, 400).x[4], past = stripLayout(5, 4.5, 1.5, 60, 10, 400).x[4];
  assert.equal(end - past, 35);
});

test("tickLift lifts the ticks near the focus, and on the web's ruler matches one tick a picture", () => {
  // One tick a picture (the web ruler): the lift is bump(i - pos, 3).
  for (const pos of [0, 1.3, 4]) for (let i = 0; i < 6; i++) assert.equal(tickLift(i, 6, 6, pos), bump(i - pos, 3));
  // More ticks than pictures: the ticks under the focus picture lift most, about three ticks either side.
  assert.equal(tickLift(20, 41, 5, 2), 1);
  assert.ok(tickLift(22, 41, 5, 2) > 0 && tickLift(22, 41, 5, 2) < 1);
  assert.equal(tickLift(24, 41, 5, 2), 0);
  // Without feedback only the focus tick shows.
  assert.equal(tickLift(2, 6, 6, 2.2, false), 1);
  assert.equal(tickLift(3, 6, 6, 2.2, false), 0);
});

test("lerpStep eases toward the target the same way at any frame rate", () => {
  assert.equal(lerpStep(0, 10, 0, LERP_RATE.held), 0);
  const one = lerpStep(0, 10, 1 / 30, LERP_RATE.jump);
  const two = lerpStep(lerpStep(0, 10, 1 / 60, LERP_RATE.jump), 10, 1 / 60, LERP_RATE.jump);
  assert.ok(Math.abs(one - two) < 1e-9);
  assert.ok(one > 0 && one < 10);
  assert.ok(LERP_RATE.held > LERP_RATE.jump && LERP_RATE.jump > LERP_RATE.glide);
});

test("releaseTarget projects a flick on and snaps to a picture inside the strip", () => {
  assert.equal(releaseTarget(2.2, 0, 80, 10), 2);
  assert.equal(releaseTarget(2.2, 0, 80, 10, true, false), 2.2);
  // A flick to the left (negative velocity) carries on to later pictures.
  assert.ok(releaseTarget(2, -1500, 80, 10) > 2);
  assert.ok(releaseTarget(2, 1500, 80, 10) < 2);
  // Without inertia it stays where it was let go.
  assert.equal(releaseTarget(2.4, -1500, 80, 10, false), 2);
  // Never past either end.
  assert.equal(releaseTarget(9, -99999, 80, 10), 9);
  assert.equal(releaseTarget(0, 99999, 80, 10), 0);
});
