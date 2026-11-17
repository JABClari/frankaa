// Type-check (and emit the declarations of) frankaa/native against a React Native app's own packages, so the repo
// itself needs none of them installed. Point FRANKAA_RN_MODULES at an Expo or React Native app's node_modules
// (React Native 0.81+, Reanimated 4, react-native-worklets, Gesture Handler 2, and Skia 2 for frankaa/native/skia).
//   FRANKAA_RN_MODULES=../my-app/node_modules npm run typecheck:native
// Without it (or when it lacks a package) the check is skipped and says so.
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const NEEDED = ["react-native", "react-native-reanimated", "react-native-worklets", "react-native-gesture-handler", "@shopify/react-native-skia", "@types/react"];
const CONFIG = "tsconfig.native.local.json";

/** Writes the generated tsconfig and returns its name, or null with the reason when there are no RN types. */
export function nativeConfig() {
  const dir = process.env.FRANKAA_RN_MODULES;
  if (!dir) return { config: null, reason: "FRANKAA_RN_MODULES is not set" };
  const root = resolve(dir);
  const missing = NEEDED.filter((p) => !existsSync(resolve(root, p, "package.json")));
  if (missing.length) return { config: null, reason: `${root} lacks ${missing.join(", ")}` };
  // Every bare import resolves in the app first, so React's types come from one place.
  writeFileSync(CONFIG, JSON.stringify({
    extends: "./tsconfig.native.json",
    compilerOptions: { paths: { "*": [`${root}/@types/*`, `${root}/*`] } },
  }, null, 2) + "\n");
  return { config: CONFIG, reason: null };
}

/** Runs tsc on the native entry. emit: write the declarations into dist. Returns false when skipped. */
export function checkNative(emit) {
  const { config, reason } = nativeConfig();
  if (!config) { console.warn(`frankaa/native: type check skipped (${reason}).`); return false; }
  execFileSync("node_modules/.bin/tsc", ["-p", config, ...(emit ? [] : ["--noEmit"])], { stdio: "inherit" });
  return true;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { checkNative(false); } catch { process.exit(1); }
}
