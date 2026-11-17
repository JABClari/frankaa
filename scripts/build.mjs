// Build: ESM bundles (esbuild), type declarations (tsc), the stylesheet, a copy for the docs page, and a size report.
import { build, transform } from "esbuild";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { checkNative } from "./native-types.mjs";

// The pure helpers mark the functions frankaa/native runs on the UI thread with a "worklet" directive. The web
// bundles do not need it, so it is taken out of them.
const stripWorklet = {
  name: "strip-worklet",
  setup(b) {
    b.onLoad({ filter: /(shared|slider-math|drumline-math|lightbox-math)\.ts$/ }, (a) => ({
      loader: "ts",
      contents: readFileSync(a.path, "utf8").replace(/^\s*"worklet";\n/gm, ""),
    }));
  },
};

rmSync("dist", { recursive: true, force: true });
await build({
  entryPoints: { index: "src/index.ts", slider: "src/slider.ts", lightbox: "src/lightbox.ts", drumline: "src/drumline.ts", react: "src/react.ts", loading: "src/loading.ts" },
  outdir: "dist",
  bundle: true,
  splitting: true,
  format: "esm",
  target: "es2020",
  minify: true,
  external: ["react", "react-dom"],
  chunkNames: "chunks/[name]-[hash]",
  legalComments: "none",
  plugins: [stripWorklet, {
    // The shaders are plain strings to esbuild; squeeze their whitespace (one line per line, so #define lines survive).
    name: "glsl-min",
    setup(b) {
      b.onLoad({ filter: /(lightbox-gl|effects|loading-shaders|\/loading)\.ts$/ }, (a) => ({
        loader: "ts",
        contents: readFileSync(a.path, "utf8").replace(/`([^`]*)`/g, (_, g) => "`" + g.split("\n").map((l) => l.replace(/\s+/g, " ").replace(/ ?([{}();,=*+\-/<>?:]) ?/g, "$1").trim()).filter(Boolean).join("\n") + "`"),
      }));
    },
  }],
});
execFileSync("node_modules/.bin/tsc", ["-p", "tsconfig.json"], { stdio: "inherit" });

// frankaa/native and frankaa/native/skia: ES modules for Metro, not minified, with the "worklet" directives kept
// for the app's Reanimated Babel plugin. React Native and its libraries stay imports (optional peers).
// Each part is its own entry: when esbuild hoists several modules into one file it renames repeated imports
// (useAnimatedStyle2), and the Babel plugin only recognises Reanimated's hooks by their real names, so their
// callbacks would not become worklets. A check below fails the build if any worklet hook is ever aliased.
await build({
  entryPoints: {
    "native/index": "src/native/index.ts",
    "native/skia": "src/native/skia.tsx",
    "native/Procession": "src/native/Procession.tsx",
    "native/Drumline": "src/native/Drumline.tsx",
    "native/Unfurl": "src/native/Unfurl.tsx",
  },
  outdir: "dist",
  bundle: true,
  splitting: true,
  format: "esm",
  target: "es2020",
  jsx: "automatic",
  chunkNames: "native/chunks/[name]-[hash]",
  legalComments: "none",
  external: ["react", "react/jsx-runtime", "react-native", "react-native-reanimated", "react-native-worklets", "react-native-gesture-handler", "@shopify/react-native-skia"],
});
{
  const HOOKS = ["useAnimatedStyle", "useAnimatedProps", "useDerivedValue", "useAnimatedReaction", "useAnimatedScrollHandler", "useFrameCallback", "useAnimatedGestureHandler"];
  for (const f of readdirSync("dist/native", { recursive: true })) {
    if (!String(f).endsWith(".js")) continue;
    const src = readFileSync(join("dist/native", String(f)), "utf8");
    for (const h of HOOKS) if (new RegExp(`\\b${h}\\s+as\\s+\\w+|\\b${h}\\d+\\(`).test(src)) throw new Error(`frankaa/native: ${h} is aliased in dist/native/${f}; its callbacks would not become worklets`);
  }
}
// Their declarations need React Native's types, read from an app (FRANKAA_RN_MODULES, see scripts/native-types.mjs).
if (!checkNative(true)) {
  try { execFileSync("node_modules/.bin/tsc", ["-p", "tsconfig.native.json"], { stdio: "ignore" }); } catch { /* emitted without RN types */ }
  console.warn("frankaa/native: declarations written without React Native's types; set FRANKAA_RN_MODULES to check them.");
}
writeFileSync("dist/style.css", (await transform(readFileSync("src/style.css", "utf8"), { loader: "css", minify: true })).code);

// The docs page loads the built files from docs/lib, so it works on its own (GitHub Pages included).
rmSync("docs/lib", { recursive: true, force: true });
mkdirSync("docs/lib", { recursive: true });
for (const f of readdirSync("dist", { recursive: true })) {
  const p = join("dist", f);
  if (statSync(p).isFile() && !p.endsWith(".d.ts") && !f.startsWith("native")) cpSync(p, join("docs/lib", f));
}

// The AI-facing files are served from the docs site too.
for (const f of ["llms.txt", "llms-full.txt"]) cpSync(f, join("docs", f));

// Size of each entry with the chunks it imports, minified and gzipped.
const read = (p) => readFileSync(p);
const deps = (file, seen = new Set()) => {
  if (seen.has(file)) return seen;
  seen.add(file);
  const src = read(file).toString();
  for (const m of src.matchAll(/from\s*"(\.\.?\/[^"]+)"|import\s*"(\.\.?\/[^"]+)"/g)) deps(join(file, "..", m[1] ?? m[2]), seen);
  return seen;
};
const kb = (b) => (b / 1024).toFixed(2) + " kB";
console.log("\nentry              min        gzip");
for (const e of ["slider", "lightbox", "drumline", "loading", "index", "react"]) {
  const files = [...deps(`dist/${e}.js`)];
  const all = Buffer.concat(files.map(read));
  console.log(`frankaa/${e.padEnd(10)} ${kb(all.length).padStart(9)}  ${kb(gzipSync(all, { level: 9 }).length).padStart(9)}`);
}
for (const e of ["native/index", "native/skia"]) {
  const all = Buffer.concat([...deps(`dist/${e}.js`)].map(read));
  console.log(`frankaa/${e.replace("/index", "").padEnd(10)} ${kb(all.length).padStart(9)}  ${kb(gzipSync(all, { level: 9 }).length).padStart(9)}  (not minified; Metro minifies)`);
}
const css = read("dist/style.css");
console.log(`style.css          ${kb(css.length).padStart(9)}  ${kb(gzipSync(css, { level: 9 }).length).padStart(9)}`);
