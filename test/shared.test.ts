import { test } from "node:test";
import assert from "node:assert/strict";
import { eventName, fill, isCrossOrigin, lightboxKey, nextIndex, resolveReduced, rubber, sliderKey, velocity } from "../src/shared.ts";

test("fill puts values into label templates and leaves unknown keys", () => {
  assert.equal(fill("Photo {n} of {total}", { n: 2, total: 5 }), "Photo 2 of 5");
  assert.equal(fill("Foto {n} de {total}", { n: 1, total: 3 }), "Foto 1 de 3");
  assert.equal(fill("{n} / {total} {x}", { n: 1, total: 2 }), "1 / 2 {x}");
});

test("resolveReduced: always and never win, system follows the setting", () => {
  assert.equal(resolveReduced("always", false), true);
  assert.equal(resolveReduced("never", true), false);
  assert.equal(resolveReduced("system", true), true);
  assert.equal(resolveReduced(undefined, false), false);
});

test("nextIndex steps, stops at the ends, and wraps with loop", () => {
  assert.equal(nextIndex(1, 1, 4, false), 2);
  assert.equal(nextIndex(3, 1, 4, false), null);
  assert.equal(nextIndex(0, -1, 4, false), null);
  assert.equal(nextIndex(3, 1, 4, true), 0);
  assert.equal(nextIndex(0, -1, 4, true), 3);
  assert.equal(nextIndex(0, 1, 1, true), null);
});

test("eventName turns hook names into DOM event names", () => {
  assert.equal(eventName("onOpenStart"), "frankaa:open-start");
  assert.equal(eventName("onChange"), "frankaa:change");
  assert.equal(eventName("onSlideChange"), "frankaa:slide-change");
  assert.equal(eventName("onAnimationEnd"), "frankaa:animation-end");
});

test("isCrossOrigin spots photos on other origins", () => {
  const base = "https://example.com/gallery/";
  assert.equal(isCrossOrigin("photos/a.jpg", base), false);
  assert.equal(isCrossOrigin("/a.jpg", base), false);
  assert.equal(isCrossOrigin("https://cdn.example.net/a.jpg", base), true);
  assert.equal(isCrossOrigin("data:image/png;base64,xx", base), false);
});

test("lightboxKey: arrows move, Home and End jump, Escape closes, others pass", () => {
  assert.equal(lightboxKey("ArrowRight"), "next");
  assert.equal(lightboxKey("ArrowLeft"), "prev");
  assert.equal(lightboxKey("Home"), "first");
  assert.equal(lightboxKey("End"), "last");
  assert.equal(lightboxKey("Escape"), "close");
  assert.equal(lightboxKey("Esc"), "close");
  assert.equal(lightboxKey("Tab"), null);
  assert.equal(lightboxKey("a"), null);
});

test("sliderKey: arrows step (swapped right to left), Home, End, Enter selects", () => {
  assert.equal(sliderKey("ArrowRight"), "next");
  assert.equal(sliderKey("ArrowLeft"), "prev");
  assert.equal(sliderKey("ArrowRight", true), "prev");
  assert.equal(sliderKey("ArrowLeft", true), "next");
  assert.equal(sliderKey("Home"), "first");
  assert.equal(sliderKey("End"), "last");
  assert.equal(sliderKey("Enter"), "select");
  assert.equal(sliderKey("ArrowUp"), null);
  assert.equal(sliderKey(" "), null);
});

test("velocity reads px/s from the last 100 ms of samples", () => {
  assert.deepEqual(velocity([]), { vx: 0, vy: 0 });
  const v = velocity([{ x: 0, y: 0, t: 0 }, { x: 0, y: 0, t: 400 }, { x: 50, y: 10, t: 450 }, { x: 100, y: 20, t: 500 }]);
  assert.equal(v.vx, 1000);
  assert.equal(v.vy, 200);
});

test("rubber resists past the limit and never passes it", () => {
  assert.equal(rubber(0, 60), 0);
  assert.ok(rubber(30, 60) < 30);
  assert.ok(rubber(1000, 60) < 60);
  assert.ok(rubber(100, 60) > rubber(50, 60));
});
