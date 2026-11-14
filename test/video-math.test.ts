import { test } from "node:test";
import assert from "node:assert/strict";
import { clampTime, formatTime, fraction, playerKey } from "../src/video-math.ts";

test("formatTime reads minutes, hours and unknown lengths", () => {
  assert.equal(formatTime(7), "0:07");
  assert.equal(formatTime(156.9), "2:36");
  assert.equal(formatTime(3725), "1:02:05");
  assert.equal(formatTime(NaN), "0:00");
  assert.equal(formatTime(Infinity), "0:00");
  assert.equal(formatTime(-3), "0:00");
});

test("clampTime keeps a seek inside the video", () => {
  assert.equal(clampTime(-5, 100), 0);
  assert.equal(clampTime(105, 100), 100);
  assert.equal(clampTime(42, 100), 42);
  assert.equal(clampTime(10, NaN), 0);
  assert.equal(clampTime(NaN, 100), 0);
});

test("fraction is 0 to 1 and 0 before the length is known", () => {
  assert.equal(fraction(50, 100), 0.5);
  assert.equal(fraction(150, 100), 1);
  assert.equal(fraction(5, NaN), 0);
  assert.equal(fraction(5, 0), 0);
});

test("playerKey maps the usual video keys", () => {
  assert.equal(playerKey(" "), "toggle");
  assert.equal(playerKey("k"), "toggle");
  assert.equal(playerKey("ArrowLeft"), "back");
  assert.equal(playerKey("ArrowRight"), "forward");
  assert.equal(playerKey("j"), "back-long");
  assert.equal(playerKey("L"), "forward-long");
  assert.equal(playerKey("m"), "mute");
  assert.equal(playerKey("f"), "fullscreen");
  assert.equal(playerKey("Escape"), null);
  assert.equal(playerKey("ArrowUp"), null);
});
