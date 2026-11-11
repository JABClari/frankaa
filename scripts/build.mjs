// Build: ESM bundles (esbuild), type declarations (tsc), the stylesheet, a copy for the docs page, and a size report.
import { build, transform } from "esbuild";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

rmSync("dist", { recursive: true, force: true });
await build({
  entryPoints: { index: "src/index.ts", slider: "src/slider.ts", lightbox: "src/lightbox.ts", react: "src/react.ts" },
  outdir: "dist",
  bundle: true,
  splitting: true,
  format: "esm",
  target: "es2020",
  minify: true,
  external: ["react"],
  chunkNames: "chunks/[name]-[hash]",
  legalComments: "none",
  plugins: [{
    // The shaders are plain strings to esbuild; squeeze their whitespace (GLSL here has no preprocessor lines).
    name: "glsl-min",
    setup(b) {
      b.onLoad({ filter: /lightbox-gl\.ts$/ }, (a) => ({
        loader: "ts",
        contents: readFileSync(a.path, "utf8").replace(/`([^`]*)`/g, (_, g) => "`" + g.replace(/\s+/g, " ").replace(/ ?([{}();,=*+\-/<>]) ?/g, "$1").trim() + "`"),
      }));
    },
  }],
});
execFileSync("node_modules/.bin/tsc", ["-p", "tsconfig.json"], { stdio: "inherit" });
writeFileSync("dist/style.css", (await transform(readFileSync("src/style.css", "utf8"), { loader: "css", minify: true })).code);

// The docs page loads the built files from docs/lib, so it works on its own (GitHub Pages included).
rmSync("docs/lib", { recursive: true, force: true });
mkdirSync("docs/lib", { recursive: true });
for (const f of readdirSync("dist", { recursive: true })) {
  const p = join("dist", f);
  if (statSync(p).isFile() && !p.endsWith(".d.ts")) cpSync(p, join("docs/lib", f));
}

// Size of each entry with the chunks it imports, minified and gzipped.
const read = (p) => readFileSync(p);
const deps = (file, seen = new Set()) => {
  if (seen.has(file)) return seen;
  seen.add(file);
  const src = read(file).toString();
  for (const m of src.matchAll(/from"(\.\/[^"]+)"|import"(\.\/[^"]+)"/g)) deps(join(file, "..", m[1] ?? m[2]), seen);
  return seen;
};
const kb = (b) => (b / 1024).toFixed(2) + " kB";
console.log("\nentry              min        gzip");
for (const e of ["slider", "lightbox", "index", "react"]) {
  const files = [...deps(`dist/${e}.js`)];
  const all = Buffer.concat(files.map(read));
  console.log(`frankaa/${e.padEnd(10)} ${kb(all.length).padStart(9)}  ${kb(gzipSync(all, { level: 9 }).length).padStart(9)}`);
}
const css = read("dist/style.css");
console.log(`style.css          ${kb(css.length).padStart(9)}  ${kb(gzipSync(css, { level: 9 }).length).padStart(9)}`);
