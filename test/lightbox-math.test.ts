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

import { clampPan, draggedBox, flipFrame, isZoomed, lockAxis, neighbours, pickRenderer, pickSlide, project, radiusAt, settleZoom, stepBox, stripStep, toR4, zoomAbout } from "../src/lightbox-math.ts";

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

test("radiusAt runs from the spot radii to the open radii and back, per corner", () => {
  const t = { x: 0, y: 0, w: 1000, h: 800 };
  const spot: [number, number, number, number] = [16, 0, 0, 16], open: [number, number, number, number] = [12, 12, 12, 12];
  assert.deepEqual(radiusAt(false, t, t, spot, open), [12, 12, 12, 12]);
  assert.deepEqual(radiusAt(false, { x: 0, y: 0, w: 0, h: 0 }, t, spot, open), [16, 0, 0, 16]);
  assert.deepEqual(radiusAt(true, t, t, spot, open), [16, 0, 0, 16]);
});

test("toR4 takes one radius or four", () => {
  assert.deepEqual(toR4(8, 16), [8, 8, 8, 8]);
  assert.deepEqual(toR4(undefined, 16), [16, 16, 16, 16]);
  assert.deepEqual(toR4([1, 2, 3, 4], 16), [1, 2, 3, 4]);
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

test("neighbours stop at the ends unless loop", () => {
  assert.deepEqual(neighbours(0, 4, false), { prev: null, next: 1 });
  assert.deepEqual(neighbours(3, 4, false), { prev: 2, next: null });
  assert.deepEqual(neighbours(3, 4, true), { prev: 2, next: 0 });
  assert.deepEqual(neighbours(0, 1, true), { prev: null, next: null });
});

test("project: a fling's resting distance grows with its velocity and keeps its sign", () => {
  assert.equal(project(0), 0);
  assert.ok(Math.abs(project(1000) - 499) < 1);
  assert.ok(project(-500) < 0);
});

test("pickSlide takes the photo nearest the projected stop", () => {
  const pitch = 400;
  assert.equal(pickSlide(-250, 0, pitch, true, true), 1);    // dragged past half way
  assert.equal(pickSlide(-100, 0, pitch, true, true), 0);    // not far enough, slow
  assert.equal(pickSlide(-60, -800, pitch, true, true), 1);  // short, but flung
  assert.equal(pickSlide(-250, 900, pitch, true, true), 0);  // far, but flung back
  assert.equal(pickSlide(250, 0, pitch, true, true), -1);
  assert.equal(pickSlide(-300, -900, pitch, true, false), 0); // nothing after the last photo
});

test("lockAxis waits for 10 px, then keeps diagonal swipes sideways", () => {
  assert.equal(lockAxis(5, 5), null);
  assert.equal(lockAxis(20, 2), "x");
  assert.equal(lockAxis(14, 14), "x");  // 45 degrees: sideways, never a close
  assert.equal(lockAxis(10, 14), "x");  // about 54 degrees: still sideways
  assert.equal(lockAxis(4, 20), "y");
});

test("stripStep brings the strip home without overshoot", () => {
  let x = -300, v = -1200, min = x, t = 0;
  while ((Math.abs(x) > 0.25 || Math.abs(v) > 2) && t < 2) { [x, v] = stripStep(x, v, 1 / 60); min = Math.min(min, x); t += 1 / 60; }
  assert.ok(t < 1, `took ${t.toFixed(2)} s`);
  assert.ok(x <= 0.25, "comes back from the left without crossing far to the right");
});

test("zoomAbout keeps the pinched point under the fingers", () => {
  const box0 = { x: 100, y: 100, w: 400, h: 300 };
  const z = zoomAbout(box0, 2, { x: 300, y: 250 }, { x: 300, y: 250 });
  assert.deepEqual(z, { x: -100, y: -50, w: 800, h: 600 });
  const moved = zoomAbout(box0, 1, { x: 300, y: 250 }, { x: 320, y: 240 });
  assert.deepEqual(moved, { x: 120, y: 90, w: 400, h: 300 });
});

test("clampPan keeps a zoomed photo covering the view and centres a small axis", () => {
  const rest = { x: 100, y: 200, w: 800, h: 400 }, view = { x: 0, y: 0, w: 1000, h: 800 };
  const big = { x: 50, y: -100, w: 1600, h: 800 };
  assert.deepEqual(clampPan(big, rest, view), { x: 0, y: 0, w: 1600, h: 800 });
  assert.deepEqual(clampPan({ ...big, x: -900 }, rest, view).x, -600);
  const wide = { x: -500, y: 0, w: 1600, h: 600 }; // shorter than the view: centred on the open box
  assert.equal(clampPan(wide, rest, view).y, 200 + (400 - 600) / 2);
});

test("settleZoom snaps back under 1x, caps at max, and clamps", () => {
  const rest = { x: 100, y: 100, w: 800, h: 600 }, view = { x: 0, y: 0, w: 1000, h: 800 };
  assert.deepEqual(settleZoom({ x: 150, y: 150, w: 700, h: 525 }, rest, 4, view), rest);
  const capped = settleZoom({ x: -2000, y: -1500, w: 4800, h: 3600 }, rest, 4, view);
  assert.equal(capped.w, 3200);
  assert.ok(isZoomed(capped, rest));
  assert.ok(!isZoomed(rest, rest));
});
