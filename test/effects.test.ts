import { test } from "node:test";
import assert from "node:assert/strict";
import { easingFn, effectNames, getEffect, PRELUDE, registerEffect, uniformKind } from "../src/effects.ts";

test("the five built-in effects are registered and follow the shader contract", () => {
  for (const n of ["displacement", "ripple", "fade", "zoom", "none"]) {
    assert.ok(effectNames().includes(n), n);
    const f = getEffect(n).fragment;
    assert.match(f, /precision mediump float;/);
    assert.match(f, /uniform float uProgress;/);
    assert.match(f, /gl_FragColor/);
  }
});

test("getEffect falls back to displacement and passes your own effect through", () => {
  assert.equal(getEffect("nope"), getEffect("displacement"));
  assert.equal(getEffect(undefined), getEffect("displacement"));
  const mine = { fragment: "void main(){}" };
  assert.equal(getEffect(mine), mine);
});

test("registerEffect adds by name and refuses an effect without a shader", () => {
  registerEffect("mosaic-test", { fragment: "void main(){}", duration: 300 });
  assert.equal(getEffect("mosaic-test").duration, 300);
  assert.throws(() => registerEffect("bad", {} as never), TypeError);
});

test("easingFn: linear, ease-in-out, the default ease-out, and your own function", () => {
  assert.equal(easingFn("linear")(0.3), 0.3);
  assert.equal(easingFn("ease-in-out")(0.5), 0.5);
  const out = easingFn(undefined);
  assert.equal(out(0), 0);
  assert.equal(out(2), 1);
  assert.ok(out(0.25) > 0.6, "ease-out is fast at the start");
  assert.ok(out(0.1) > easingFn("linear")(0.1), "no slow start");
  assert.equal(easingFn((t) => t * t)(0.5), 0.25);
});

test("uniformKind maps values to setters and rejects the rest", () => {
  assert.equal(uniformKind(0.4), "1f");
  assert.equal(uniformKind([1, 2]), "2fv");
  assert.equal(uniformKind([1, 2, 3, 4]), "4fv");
  assert.equal(uniformKind(Number.NaN), null);
  assert.equal(uniformKind([1] as never), null);
});

test("the prelude defines the helper macros", () => {
  assert.match(PRELUDE, /#define coverUv/);
  assert.match(PRELUDE, /#define mirrorUv/);
});
