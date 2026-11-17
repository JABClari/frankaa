import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Runs on the build (npm test builds first).
const files = (dir: string): string[] => readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".js")).map((f) => join(dir, f));
const web = files("dist").filter((f) => !f.startsWith(join("dist", "native")));

test("the web bundles carry nothing for React Native: no worklet directives, no React Native imports", () => {
  for (const f of web) {
    const s = readFileSync(f, "utf8");
    assert.ok(!s.includes('"worklet"'), `${f} has a worklet directive`);
    assert.ok(!/react-native|@shopify\/react-native-skia/.test(s), `${f} imports React Native`);
  }
});

test("frankaa/native keeps the worklet directives for the app's Reanimated plugin, and imports its libraries", () => {
  const files = readdirSync(join("dist", "native"), { recursive: true }).map(String).filter((f) => f.endsWith(".js") && f !== "skia.js");
  const s = files.map((f) => readFileSync(join("dist", "native", f), "utf8")).join("\n");
  for (const fn of ["stripLayout", "tickLift", "lerpStep", "releaseTarget", "bandPos", "pickSlide", "pullFrame", "mixBox", "flipFrame", "band"]) {
    assert.match(s, new RegExp(`function ${fn}\\([^)]*\\) \\{\\s*"worklet";`), `${fn} is a worklet`);
  }
  assert.match(s, /from "react-native-reanimated"/);
  assert.ok(!s.includes("@shopify/react-native-skia"), "Skia only in frankaa/native/skia");
  assert.match(readFileSync(join("dist", "native", "skia.js"), "utf8"), /from "@shopify\/react-native-skia"/);
});

test("frankaa/native never renames Reanimated's worklet hooks (the Babel plugin only knows their real names)", () => {
  for (const f of readdirSync(join("dist", "native"), { recursive: true }).map(String).filter((f) => f.endsWith(".js"))) {
    const s = readFileSync(join("dist", "native", f), "utf8");
    for (const h of ["useAnimatedStyle", "useAnimatedProps", "useDerivedValue", "useAnimatedReaction", "useFrameCallback"]) {
      assert.ok(!new RegExp(`\\b${h}\\s+as\\s+\\w+|\\b${h}\\d+\\(`).test(s), `${h} aliased in ${f}`);
    }
  }
});
