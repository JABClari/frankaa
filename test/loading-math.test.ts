import { test } from "node:test";
import { isColor, previewOf } from "../src/items.ts";
import assert from "node:assert/strict";
import { frameAspect, givenAspect, latest, loadingDelay, loadingKind, loadingView, noiseBytes, revealProgress, LOAD_GRACE_MS } from "../src/loading-math.ts";

test("loadingKind reads names, shaders and views; anything else is the film", () => {
  assert.deepEqual(loadingKind(undefined), { material: "film" });
  assert.deepEqual(loadingKind("frost"), { material: "frost" });
  assert.deepEqual(loadingKind("liquid"), { material: "liquid" });
  assert.deepEqual(loadingKind("none"), { material: "none" });
  assert.deepEqual(loadingKind("nope" as never), { material: "film" });
  const shader = { fragment: "void main() {}" };
  assert.deepEqual(loadingKind(shader), { material: "film", shader });
  const render = () => {};
  assert.deepEqual(loadingKind(render), { material: "none", render });
});

test("loadingDelay defaults to 250 and takes 0", () => {
  assert.equal(loadingDelay(undefined), 250);
  assert.equal(loadingDelay(0), 0);
  assert.equal(loadingDelay(600), 600);
  assert.equal(loadingDelay(-5), 250);
  assert.equal(loadingDelay(Number.NaN), 250);
});

test("previewOf: placeholder image, else thumb, else src; never the file still loading", () => {
  assert.equal(previewOf({ src: "a.jpg", placeholder: "data:image/png;base64,xx" }, "a.jpg"), "data:image/png;base64,xx");
  assert.equal(previewOf({ src: "a.jpg", thumb: "a-200.jpg", placeholder: "#eee" }, "a.jpg"), "a-200.jpg");
  assert.equal(previewOf({ src: "a.jpg" }, "a-full.jpg"), "a.jpg");
  assert.equal(previewOf({ src: "a.jpg" }, "a.jpg"), null);
  assert.equal(previewOf({ src: "a.jpg", placeholder: "tan" }, "a.jpg"), null);
});

test("isColor tells colours from image addresses", () => {
  for (const c of ["#fff", "rgb(1, 2, 3)", "oklch(70% .1 40)", "var(--x)", "tan", " hsl(1 2% 3%) "]) assert.ok(isColor(c), c);
  for (const u of ["a.jpg", "/img/a.jpg", "data:image/png;base64,xx", "https://x.dev/a.webp"]) assert.ok(!isColor(u), u);
});

test("frameAspect: the photo's own shape, then given, then preview, then the box before, then 3:2", () => {
  assert.equal(frameAspect({ natural: 2, given: 1, preview: 0.5, previous: 3 }), 2);
  assert.equal(frameAspect({ natural: null, given: 1, preview: 0.5 }), 1);
  assert.equal(frameAspect({ preview: 0.5, previous: 3 }), 0.5);
  assert.equal(frameAspect({ previous: 3 }), 3);
  assert.equal(frameAspect({ natural: Number.NaN, given: 0 }), 1.5);
  assert.equal(givenAspect(1600, 900), 1600 / 900);
  assert.equal(givenAspect(1600, 0), undefined);
  assert.equal(givenAspect(), undefined);
});

test("loadingView: the ring and the label wait for the delay; ready completes; failed shows the message", () => {
  assert.deepEqual(loadingView("loading", 100, 250), { ring: "off", busy: false, message: false, announce: null });
  assert.deepEqual(loadingView("loading", 250, 250), { ring: "spin", busy: true, message: false, announce: "loading" });
  assert.deepEqual(loadingView("loading", 0, 0), { ring: "spin", busy: true, message: false, announce: "loading" });
  assert.deepEqual(loadingView("ready", 900, 250), { ring: "done", busy: false, message: false, announce: null });
  assert.deepEqual(loadingView("failed", 10, 250), { ring: "off", busy: false, message: true, announce: "failed" });
  assert.deepEqual(loadingView("idle", 10, 250).ring, "off");
});

test("revealProgress eases out over 700 ms; reduced motion is a short linear fade", () => {
  assert.equal(revealProgress(0, false), 0);
  assert.equal(revealProgress(700, false), 1);
  assert.ok(revealProgress(350, false) > 0.8);
  assert.equal(revealProgress(80, true), 0.5);
  assert.equal(revealProgress(-1, true), 0);
  assert.equal(revealProgress(9999, true), 1);
});

test("latest: only the newest ticket wins", () => {
  const l = latest();
  const a = l.take(), b = l.take();
  assert.ok(!l.is(a));
  assert.ok(l.is(b));
});

test("noiseBytes is seeded, full size and spread", () => {
  const a = noiseBytes(64), b = noiseBytes(64);
  assert.equal(a.length, 64 * 64 * 4);
  assert.deepEqual(a, b);
  const mean = a.reduce((s, v) => s + v, 0) / a.length;
  assert.ok(mean > 110 && mean < 145, String(mean));
  assert.ok(LOAD_GRACE_MS < 100);
});
