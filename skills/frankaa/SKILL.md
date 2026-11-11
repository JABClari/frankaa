---
name: frankaa
description: Add or fix photo sliders and photo lightboxes with the frankaa package (procession slider, unfurl lightbox, React bindings, WebGL or CSS renderer, custom GLSL transition shaders). Use when a project needs a swipeable photo carousel, a listing-card photo slider, a gallery grid that opens a fullscreen lightbox, image transition effects, or when frankaa is already a dependency.
---

# frankaa

frankaa is a zero-dependency photo slider (`procession`) and lightbox (`unfurl`) with thin React bindings. Full reference: `node_modules/frankaa/llms-full.txt` (read it before writing code). Agent rules: `node_modules/frankaa/AGENTS.md`.

## Steps

1. Install: `npm install frankaa` (explain to the person that it is a runtime dependency with no dependencies of its own).
2. Import the styles once: `import "frankaa/style.css"`.
3. Pick the import: `frankaa/slider`, `frankaa/lightbox`, `frankaa` (both) or `frankaa/react`.
4. Wire it:
   - Slider: `procession(element, { photos, label })`, or `<Procession photos label ref />` in React.
   - Lightbox: `unfurl({ photos, start, origin: (n) => thumbElement(n) })`, or `useUnfurl(photos, { origin })` then `open(i)`.
   - Slider opening the lightbox: `onSelect: (i) => unfurl({ photos, start: i, origin: (n) => slider.image(n), onChange: (n) => slider.go(n, false) })`.
5. In Next.js or any SSR framework, use it only in client components and never at module top level.
6. Verify with the checklist below.

## Decisions

- `renderer: "auto"` (default). Use `"css"` for cross-origin photos without CORS headers, or when WebGL is unwanted.
- Effects: `"displacement"` (default), `"ripple"`, `"fade"`, `"zoom"`, `"none"`, or a custom shader.
- Custom shader: GLSL ES 1.0 fragment with `precision mediump float;`, `vUv`, `uFrom`, `uTo`, `uProgress`, `uResolution`, `uFromSize`, `uToSize`, `uTime`, `uDirection`, own uniforms; output `gl_FragColor`; macros `coverUv()` and `mirrorUv()`. Register with `registerEffect(name, { fragment, uniforms })`, check with `checkEffect()`. Compile errors fire `onError` and fall back to CSS. Never compile shader source from users.
- Autoplay off, `reducedMotion: "system"`, unless the person asks.
- Translate with `labels` (`{n}` and `{total}` placeholders).
- Listen with hooks (`onOpenStart`, `onOpenEnd`, `onCloseStart`, `onCloseEnd`, `onChange`, `onSlideChange`, `onAnimationStart`, `onAnimationEnd`, `onError`) or DOM events `frankaa:<kebab-name>`.

## Checklist

- Styles imported; slider has an aspect ratio or height (no layout shift); photos have `alt`, `width`, `height`.
- Keyboard: slider arrows and Enter; lightbox arrows, Escape, Tab trapped, focus returns on close.
- Reduced motion gives a fade; thumbnails spring out and back; no console errors or `frankaa:error` events.
