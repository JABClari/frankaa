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

test("swipeIntent: sideways moves, down closes, still is a tap, short flicks count", () => {
  assert.equal(swipeIntent(-120, 0, -100, 0), "next");
  assert.equal(swipeIntent(120, 0, 100, 0), "prev");
  assert.equal(swipeIntent(-30, 0, -900, 0), "next"); // a short fast flick
  assert.equal(swipeIntent(-30, 0, -100, 0), null);  // a short slow drag springs back
  assert.equal(swipeIntent(0, 120, 0, 50), "close");
  assert.equal(swipeIntent(0, 40, 0, 800), "close"); // a flick down
  assert.equal(swipeIntent(2, 3), "tap");
  assert.equal(swipeIntent(20, 30, 0, 0), null);
});

test("swipeIntent: a drag released while heading back does not count", () => {
  assert.equal(swipeIntent(-120, 0, 600, 0), null);
  assert.equal(swipeIntent(0, 150, 0, -600), null);
});

test("onScreen rejects tiny and off-screen spots", () => {
  assert.ok(onScreen({ left: 10, top: 10, width: 200, height: 150 }, 1000, 800));
  assert.ok(!onScreen({ left: 10, top: 10, width: 2, height: 150 }, 1000, 800));
  assert.ok(!onScreen({ left: -400, top: 10, width: 200, height: 150 }, 1000, 800));
  assert.ok(!onScreen({ left: 10, top: 900, width: 200, height: 150 }, 1000, 800));
});

import { draggedBox, flipFrame, pickRenderer, radiusAt, stepBox } from "../src/lightbox-math.ts";

test("flipFrame moves and scales the layer and keeps the photo undistorted", () => {
  const rest = { x: 100, y: 50, w: 800, h: 600 };
  assert.deepEqual(flipFrame(rest, rest), { tx: 0, ty: 0, sx: 1, sy: 1, ix: 1, iy: 1 });
  const f = flipFrame({ x: 10, y: 20, w: 200, h: 200 }, rest);
  assert.equal(f.tx, -90); assert.equal(f.ty, -30);
  assert.equal(f.sx, 0.25); assert.ok(Math.abs(f.sy - 1 / 3) < 1e-9);
  // The photo's own scale times the layer's scale is the same on both axes (no stretch), and covers the box.
  assert.ok(Math.abs(f.ix * f.sx - f.iy * f.sy) < 1e-9);
  assert.ok(f.ix >= 1 && f.iy >= 1);
});

test("radiusAt runs from the spot radius to the open radius and back", () => {
  const t = { x: 0, y: 0, w: 1000, h: 800 };
  assert.equal(radiusAt(false, t, t, 16, 12), 12);
  assert.equal(radiusAt(false, { x: 0, y: 0, w: 0, h: 0 }, t, 16, 12), 16);
  assert.equal(radiusAt(true, t, t, 16, 12), 16);
});

test("stepBox springs all four sides to the target", () => {
  const box = { x: 0, y: 0, w: 10, h: 10 }, vel = [0, 0, 0, 0], target = { x: 300, y: 200, w: 800, h: 600 };
  let n = 0;
  while (stepBox(box, vel, target, 1 / 60, SPRING_OPEN) && n < 240) n++;
  assert.ok(n < 120, `took ${n} frames`);
  assert.ok(Math.abs(box.w - 800) < 0.25 && Math.abs(box.y - 200) < 0.25);
});

test("pickRenderer: css when asked or without WebGL, else WebGL", () => {
  assert.equal(pickRenderer("auto", true), "webgl");
  assert.equal(pickRenderer(undefined, true), "webgl");
  assert.equal(pickRenderer("auto", false), "css");
  assert.equal(pickRenderer("css", true), "css");
  assert.equal(pickRenderer("webgl", false), "css");
});

test("the springs land without a bounce, and closing is quicker than opening", () => {
  const run = (cfg: typeof SPRING_OPEN) => {
    let x = 0, v = 0, t = 0, peak = 0, t95 = 0;
    while (!settled(x, v, 1000) && t < 2) { [x, v] = springStep(x, v, 1000, 1 / 240, cfg); t += 1 / 240; peak = Math.max(peak, x); if (!t95 && x > 950) t95 = t; }
    return { t: t95, overshoot: peak - 1000 };
  };
  const open = run(SPRING_OPEN), close = run(SPRING_CLOSE);
  assert.ok(open.overshoot < 1, `open overshoots ${open.overshoot.toFixed(2)} px`);
  assert.ok(close.overshoot < 1, `close overshoots ${close.overshoot.toFixed(2)} px`);
  assert.ok(close.t < open.t, "exit faster than entrance");
  assert.ok(open.t < 0.3, `open takes ${open.t.toFixed(2)} s to cover 95%`);
});

test("stepBox keeps release velocity: a flick overshoots the spring's resting path less than it starts", () => {
  const target = { x: 0, y: 0, w: 100, h: 100 };
  const a = { ...target, y: 200 }, b = { ...target, y: 200 };
  const va = [0, 0, 0, 0], vb = [0, 2000, 0, 0];
  stepBox(a, va, target, 1 / 60, SPRING_OPEN);
  stepBox(b, vb, target, 1 / 60, SPRING_OPEN);
  assert.ok(b.y > a.y, "the downward flick carries on before the spring turns it");
});

test("draggedBox moves and scales the open box about its centre", () => {
  const rest = { x: 100, y: 100, w: 400, h: 200 };
  assert.deepEqual(draggedBox(rest, { x: 0, y: 0, s: 1 }), rest);
  assert.deepEqual(draggedBox(rest, { x: 10, y: 50, s: 0.5 }), { x: 210, y: 200, w: 200, h: 100 });
});
