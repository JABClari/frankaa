// Server rendering of the React bindings, against the built package (npm test builds first).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
// @ts-ignore: the built file has its own types beside it
import { Procession, useUnfurl } from "../dist/react.js";

test("Procession renders its first photo on the server, so the first paint is not empty", () => {
  const html = renderToString(createElement(Procession, {
    photos: [{ src: "/a-800.jpg", srcset: "/a-800.jpg 800w, /a.jpg 1600w", sizes: "50vw", placeholder: "#d9cbb5", width: 800, height: 600 }, "/b.jpg"],
    className: "card", priority: true,
  }));
  assert.match(html, /class="fk-procession card"/);
  assert.match(html, /<img[^>]*class="fk-ssr"[^>]*src="\/a-800.jpg"/);
  assert.match(html, /srcSet="\/a-800.jpg 800w, \/a.jpg 1600w"|srcset="\/a-800.jpg 800w, \/a.jpg 1600w"/i);
  assert.match(html, /background-color:#d9cbb5/);
  assert.match(html, /loading="eager"/);
});

test("Procession starts on the start photo, and renders nothing extra with no photos", () => {
  assert.match(renderToString(createElement(Procession, { photos: ["/a.jpg", "/b.jpg"], start: 1 })), /src="\/b.jpg"/);
  assert.doesNotMatch(renderToString(createElement(Procession, { photos: [] })), /<img/);
});

test("useUnfurl renders on the server without touching the DOM", () => {
  const Card = () => { const lb = useUnfurl(["/a.jpg"]); return createElement("div", null, lb.portal); };
  assert.equal(renderToString(createElement(Card)), "<div></div>");
});
