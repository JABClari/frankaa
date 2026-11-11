import { test } from "node:test";
import assert from "node:assert/strict";
import { eventName, fill, isCrossOrigin, nextIndex, resolveReduced } from "../src/shared.ts";

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
