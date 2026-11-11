import { test } from "node:test";
import assert from "node:assert/strict";
import { clampIndex, indexAt } from "../src/slider-math.ts";

test("indexAt rounds the scroll offset to the nearest photo", () => {
  assert.equal(indexAt(0, 300, 5), 0);
  assert.equal(indexAt(149, 300, 5), 0);
  assert.equal(indexAt(151, 300, 5), 1);
  assert.equal(indexAt(900, 300, 5), 3);
});

test("indexAt clamps past either end and reads right-to-left offsets", () => {
  assert.equal(indexAt(5000, 300, 5), 4);
  assert.equal(indexAt(-600, 300, 5), 2);
  assert.equal(indexAt(100, 0, 5), 0);
  assert.equal(indexAt(100, 300, 0), 0);
});

test("clampIndex keeps a wanted index inside the list", () => {
  assert.equal(clampIndex(-3, 4), 0);
  assert.equal(clampIndex(9, 4), 3);
  assert.equal(clampIndex(1.6, 4), 2);
  assert.equal(clampIndex(Number.NaN, 4), 0);
  assert.equal(clampIndex(2, 0), 0);
});
