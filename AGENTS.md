# AGENTS.md: integrating frankaa

Guidance for AI coding agents adding frankaa (a photo slider and lightbox) to a project. The full API with recipes is in `llms-full.txt` (also at `node_modules/frankaa/llms-full.txt` after install).

## Install

```sh
npm install frankaa
```

Zero runtime dependencies. React is an optional peer dependency, needed only for `frankaa/react`.

## Import paths

| Need | Import |
| --- | --- |
| Slider only | `import { procession } from "frankaa/slider"` |
| Lightbox only | `import { unfurl } from "frankaa/lightbox"` |
| Both | `import { procession, unfurl } from "frankaa"` |
| React | `import { Procession, useUnfurl } from "frankaa/react"` |
| Styles (always, once) | `import "frankaa/style.css"` |

## Decision rules

- **Renderer.** Keep the default `renderer: "auto"`. Choose `"css"` when the photos live on another origin that does not send CORS headers, when the project bans WebGL, or for the lightest path. Choose `"webgl"` only to make missing WebGL show up as an `onError`.
- **CORS.** WebGL needs `Access-Control-Allow-Origin` on cross-origin photos. If you cannot add it, use `renderer: "css"`. Never strip `crossOrigin` or proxy images just to get WebGL.
- **SSR.** frankaa touches the DOM only in effects and event handlers. In Next.js App Router, Remix or similar, put the component in a client component (`"use client"`). Never call `procession()` or `unfurl()` at module top level or during render.
- **Origin.** Pass `origin` so the photo springs from and back to its thumbnail, and set `radius` to the thumbnail's border radius. From a slider, use `origin: (n) => slider.image(n)` and `onChange: (n) => slider.go(n, false)`.
- **Effects.** Default `"displacement"`. Use `"fade"` for a quiet product, `"none"` for instant. Custom shaders: register with `registerEffect` and check with `checkEffect`; never compile shader source from users.
- **Autoplay** stays off unless the person asks for it.
- **Reduced motion** stays `"system"` unless the person asks otherwise.

## Pitfalls

- Forgetting `frankaa/style.css`: the slider will not snap and the lightbox will not cover the page.
- A slider element with no height: give it width from the layout and keep the default 4:3 aspect ratio or set your own, so nothing shifts while photos load. Pass `width` and `height` on photos.
- Thumbnails that are not focusable: wrap each in `<button type="button" aria-label="Open photo N: ...">`.
- Missing `alt` text on photos. Always pass it.
- Opening a lightbox from a slider without keeping the slider in step: it then closes to the wrong spot.
- Wrapping `Procession` photos in a new array on every render is fine (it rebuilds only when sources change), but do not change `labels` objects on every render without need.
- Expecting the slider to loop infinitely: `loop` rewinds from the last photo to the first.
- The lightbox does not wrap by default (the ends rubber-band); pass `loop: true` to wrap.
- Using `innerHTML` to build captions: pass plain text; frankaa sets it with `textContent`.

## Custom shaders

GLSL ES 1.0 fragment shader with `precision mediump float;`, `varying vec2 vUv`, uniforms `uFrom`, `uTo`, `uProgress`, `uResolution`, `uFromSize`, `uToSize`, `uTime`, `uDirection`, plus your own; write `gl_FragColor`. Macros `coverUv(uv, texSize, resolution)` and `mirrorUv(uv)` are predefined. A compile error fires `onError` with `reason: "shader"` and falls back to CSS. See `llms-full.txt` section 5.10.

## Verify the integration

- [ ] `import "frankaa/style.css"` is present once.
- [ ] Keyboard: the slider takes focus with Tab; Left and Right move it; Enter opens the lightbox (if wired).
- [ ] In the lightbox: Left and Right move, Home and End jump, Escape closes, Tab stays inside, and focus returns to the thumbnail or slider after closing.
- [ ] Screen reader names: the slider has a `label`, the lightbox has a `label`, every photo has `alt`.
- [ ] Reduced motion: with the system setting on (or `reducedMotion: "always"`), opening is a short fade and the slider steps without smooth scrolling.
- [ ] No layout shift: the slider has a fixed aspect ratio or height before photos load; photos pass `width` and `height`.
- [ ] Opening from a thumbnail springs from it and closing returns to it (the thumbnail is hidden while open).
- [ ] No console errors. If photos are cross-origin, check for `frankaa:error` with `reason: "cors"` and fix CORS or use `renderer: "css"`.
- [ ] SSR builds (Next.js `next build`) pass, with frankaa used only in client components.
