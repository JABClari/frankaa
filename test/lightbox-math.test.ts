import { test } from "node:test";
import assert from "node:assert/strict";
import { containBox, easeInOut, onScreen, settled, springStep, stageBox, swipeIntent, SPRING_CLOSE, SPRING_OPEN } from "../src/lightbox-math.ts";

test("containBox fits wide and tall photos inside the area, centred", () => {
  const area = { x: 0, y: 0, w: 1000, h: 500 };
  assert.deepEqual(containBox(2, area), { x: 0, y: 0, w: 1000, h: 500 });
  assert.deepEqual(containBox(1, area), { x: 250, y: 0, w: 500, h: 500 });
  assert.deepEqual(containBox(4, area), { x: 0, y: 125, w: 1000, h: 250 });
});

test("containBox falls back to 3:2 for a bad aspect", () => {
  const b = containBox(Number.NaN, { x: 0, y: 0, w: 300, h: 1000 });
  assert.equal(b.w / b.h, 1.5);
});

test("stageBox leaves more room for controls on a wide screen", () => {
  assert.deepEqual(stageBox(1440, 900), { x: 88, y: 72, w: 1264, h: 740 });
  assert.deepEqual(stageBox(375, 812), { x: 12, y: 64, w: 351, h: 652 });
});

for (const [name, cfg] of [["open", SPRING_OPEN], ["close", SPRING_CLOSE]] as const) {
  test(`the ${name} spring settles on its target within a second without blowing up`, () => {
    let x = 0, v = 0, t = 0;
    while (!settled(x, v, 400) && t < 2) { [x, v] = springStep(x, v, 400, 1 / 120, cfg); t += 1 / 120; }
    assert.ok(t < 1, `took ${t.toFixed(2)} s`);
    assert.ok(Math.abs(x - 400) < 0.25);
  });
}

test("easeInOut runs 0 to 1, symmetric, clamped", () => {
  assert.equal(easeInOut(0), 0);
  assert.equal(easeInOut(1), 1);
  assert.equal(easeInOut(0.5), 0.5);
  assert.equal(easeInOut(-1), 0);
  assert.equal(easeInOut(2), 1);
  assert.ok(Math.abs(easeInOut(0.25) + easeInOut(0.75) - 1) < 1e-9);
});

test("swipeIntent: sideways moves, down closes, still is a tap", () => {
  assert.equal(swipeIntent(-120, 10, 300), "next");
  assert.equal(swipeIntent(120, 10, 300), "prev");
  assert.equal(swipeIntent(-30, 2, 40), "next"); // a short fast flick
  assert.equal(swipeIntent(5, 120, 400), "close");
  assert.equal(swipeIntent(2, 3, 100), "tap");
  assert.equal(swipeIntent(20, 20, 600), null);
});

test("onScreen rejects tiny and off-screen spots", () => {
  assert.ok(onScreen({ left: 10, top: 10, width: 200, height: 150 }, 1000, 800));
  assert.ok(!onScreen({ left: 10, top: 10, width: 2, height: 150 }, 1000, 800));
  assert.ok(!onScreen({ left: -400, top: 10, width: 200, height: 150 }, 1000, 800));
  assert.ok(!onScreen({ left: 10, top: 900, width: 200, height: 150 }, 1000, 800));
});
