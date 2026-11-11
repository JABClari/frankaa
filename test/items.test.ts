import { test } from "node:test";
import assert from "node:assert/strict";
import { fullSrc, NEUTRAL_POSTER, readArgs, slideSrc, thumbSrc, toItem } from "../src/items.ts";

test("readArgs takes (items, options) and ({ items, ...options }), and the older photos", () => {
  const a = readArgs<{ items?: string[]; photos?: string[]; start?: number }>(["a.jpg", "b.jpg"], { start: 1 });
  assert.deepEqual(a.items, [{ src: "a.jpg" }, { src: "b.jpg" }]);
  assert.equal(a.options.start, 1);
  const b = readArgs<{ items?: string[]; start?: number }>({ items: ["c.jpg"], start: 2 });
  assert.deepEqual(b.items, [{ src: "c.jpg" }]);
  const c = readArgs<{ photos?: string[] }>({ photos: ["d.jpg"] });
  assert.deepEqual(c.items, [{ src: "d.jpg" }]);
  assert.deepEqual(readArgs<{ items?: string[] }>({}).items, []);
});

test("each part picks its file: slider src, lightbox full, strip thumb", () => {
  const x = { src: "m.jpg", full: "l.jpg", thumb: "s.jpg" };
  assert.equal(slideSrc(x), "m.jpg");
  assert.equal(fullSrc(x), "l.jpg");
  assert.equal(thumbSrc(x), "s.jpg");
  const y = toItem("only.jpg");
  assert.equal(slideSrc(y), "only.jpg");
  assert.equal(fullSrc(y), "only.jpg");
  assert.equal(thumbSrc(y), "only.jpg");
});

test("videos stand in with their poster, or a neutral 16:9 still without one", () => {
  const v = { type: "video" as const, provider: "youtube" as const, src: "dQw4w9WgXcQ", poster: "p.jpg" };
  assert.equal(slideSrc(v), "p.jpg");
  assert.equal(fullSrc(v), "p.jpg");
  const w = { type: "video" as const, provider: "mp4" as const, src: "/a.mp4" };
  assert.equal(fullSrc(w), NEUTRAL_POSTER);
  assert.match(NEUTRAL_POSTER, /^data:image\/svg\+xml,/);
  assert.match(decodeURIComponent(NEUTRAL_POSTER), /viewBox="0 0 1600 900"/);
});
