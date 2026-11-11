// Renders launch.html at 2x, one PNG per image, then scales each to its exact size (ffmpeg, Lanczos).   node brand/launch/render.mjs
import { chromium } from '/Users/jabclari/Documents/SIRIUS ARC/crown/node_modules/playwright/index.mjs';
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = { og: 'og.png', github: 'github-social.png', x: 'x-card.png', square: 'square.png', ph1: 'product-hunt-1.png', ph2: 'product-hunt-2.png', ph3: 'product-hunt-3.png', ph4: 'product-hunt-4.png', ph5: 'product-hunt-5.png', thumb: 'product-hunt-thumb.png' };
const b = await chromium.launch();
for (const [id, file] of Object.entries(OUT)) {
  const p = await b.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 2 });
  await p.goto('file://' + path.join(HERE, 'launch.html') + '?id=' + id);
  const { W, H } = await p.evaluate(() => window.READY);
  const tmp = path.join(HERE, 'src', '_' + id + '@2x.png');
  await p.screenshot({ path: tmp, clip: { x: 0, y: 0, width: W, height: H } });
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', tmp, '-vf', `scale=${W}:${H}:flags=lanczos`, path.join(HERE, file)]);
  execFileSync('rm', [tmp]);
  console.log(file, W + 'x' + H); await p.close();
}
await b.close();
