import { test } from "node:test";
import assert from "node:assert/strict";
import { embedUrl, videoId } from "../src/media.ts";

test("videoId reads YouTube links in every common shape", () => {
  for (const s of ["dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3", "https://youtu.be/dQw4w9WgXcQ", "https://www.youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube.com/embed/dQw4w9WgXcQ"]) {
    assert.equal(videoId("youtube", s), "dQw4w9WgXcQ", s);
  }
  assert.equal(videoId("youtube", "https://www.youtube.com/watch?v=short"), null);
});

test("videoId reads Vimeo, TikTok and Instagram", () => {
  assert.equal(videoId("vimeo", "https://vimeo.com/76979871"), "76979871");
  assert.equal(videoId("vimeo", "https://player.vimeo.com/video/76979871?h=abc"), "76979871");
  assert.equal(videoId("tiktok", "https://www.tiktok.com/@someone/video/7212345678901234567"), "7212345678901234567");
  assert.equal(videoId("instagram", "https://www.instagram.com/reel/C1a2B3c4D5e/"), "C1a2B3c4D5e");
  assert.equal(videoId("instagram", "https://www.instagram.com/p/C1a2B3c4D5e/"), "C1a2B3c4D5e");
});

test("embedUrl uses the privacy players and refuses anything that does not fit", () => {
  assert.match(embedUrl("youtube", "https://youtu.be/dQw4w9WgXcQ")!, /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/);
  assert.match(embedUrl("vimeo", "76979871")!, /^https:\/\/player\.vimeo\.com\/video\/76979871\?autoplay=1&dnt=1$/);
  assert.match(embedUrl("vimeo", "https://vimeo.com/76979871?h=1a2b3c4d")!, /&h=1a2b3c4d$/);
  assert.equal(embedUrl("tiktok", "7212345678901234567"), "https://www.tiktok.com/embed/v2/7212345678901234567");
  assert.equal(embedUrl("instagram", "C1a2B3c4D5e"), "https://www.instagram.com/p/C1a2B3c4D5e/embed/");
  assert.equal(embedUrl("youtube", "javascript:alert(1)"), null);
  assert.equal(embedUrl("youtube", "https://evil.example/embed/<script>"), null);
  assert.equal(embedUrl("vimeo", "https://vimeo.com/76979871?h=\"><x"), "https://player.vimeo.com/video/76979871?autoplay=1&dnt=1");
});

test("embedUrl for mp4 accepts http(s) and relative files only", () => {
  assert.equal(embedUrl("mp4", "https://cdn.example.com/a.mp4"), "https://cdn.example.com/a.mp4");
  assert.equal(embedUrl("mp4", "/media/a.mp4"), "/media/a.mp4");
  assert.equal(embedUrl("mp4", "javascript:alert(1)"), null);
  assert.equal(embedUrl("mp4", "data:video/mp4;base64,AAAA"), null);
});
