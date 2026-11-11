<p><img src="brand/frankaa-logo.svg" alt="frankaa" width="300" height="64"></p>

# frankaa

Said FRAN-kah.

Along the Fante coast of Ghana, each Asafo company has its frankaa: flags of bold appliqué, pictures cut from coloured cloth and sewn onto a field. At festivals they are carried one after another in procession, then unfurled so the whole picture can be seen.

This package is named after them, and has two parts:

- **procession**, a photo slider. A native scroll-snap track, so a swipe follows the finger 1:1 and keeps its momentum. Dots, arrows on hover, lazy loading, and optional loop and autoplay.
- **unfurl**, a photo lightbox. The photo lifts out of its spot and springs to full view, moves to the next photo with an effect, and springs back when closed. WebGL shader effects (built-in or your own) or a CSS renderer that uses transform and opacity only.

Plain TypeScript with no dependencies, and thin optional React bindings. Live demo and playground: https://jabclari.github.io/frankaa/

## Install

```sh
npm install frankaa
```

## Quick start

```js
import { procession, unfurl } from "frankaa";
import "frankaa/style.css";

const photos = [
  { src: "/photos/terrace.jpg", alt: "Terrace over the sea" },
  { src: "/photos/pool.jpg", alt: "Pool at evening" },
  { src: "/photos/room.jpg", alt: "Bedroom" },
];

const slider = procession(document.querySelector("#card"), {
  photos,
  label: "Sea terrace",
  onSelect: (i) =>
    unfurl({
      photos,
      start: i,
      origin: (n) => slider.image(n), // spring from, and back to, the slider's photo
      onChange: (n) => slider.go(n, false), // keep the slider on the photo being shown
    }),
});
```

Each part can be imported on its own: `frankaa/slider` and `frankaa/lightbox`.

### React and Next.js

```jsx
"use client";
import { useRef } from "react";
import { Procession, useUnfurl } from "frankaa/react";
import "frankaa/style.css";

export function Card({ photos }) {
  const slider = useRef(null);
  const lightbox = useUnfurl(photos, {
    origin: (n) => slider.current?.image(n) ?? null,
    onChange: (n) => slider.current?.go(n, false),
  });
  return <Procession ref={slider} photos={photos} label="Sea terrace" onSelect={(i) => lightbox.open(i)} />;
}
```

The bindings are safe to import during server rendering: nothing touches the DOM until an effect runs. In the Next.js App Router, use them from a client component as above.

## procession (the slider)

`procession(element, options)` turns an element into a slider and returns its controls. The element keeps its own children. It is 4:3 by default; size it with CSS.

| Option | Type | Default | |
| --- | --- | --- | --- |
| `photos` | `(Photo \| string)[]` | required | `{ src, srcset?, sizes?, alt?, width?, height? }`, or a plain `src` |
| `label` | `string` | `"Photos"` | Shorthand for `labels.region` |
| `labels` | `Partial<ProcessionLabels>` | English | Every string, for translation (below) |
| `start` | `number` | `0` | Photo to start on |
| `dots` | `boolean` | `true` | Show the dots |
| `arrows` | `boolean` | `true` | Show the arrows on hover (mouse only) and keyboard focus |
| `snap` | `"mandatory" \| "proximity"` | `"mandatory"` | Proximity lets a slow drag rest between photos |
| `loop` | `boolean` | `false` | Arrows, keys and autoplay wrap from the last photo to the first (it rewinds) |
| `autoplay` | `number \| false` | `false` | Move every so many ms (at least 1500). Pauses on hover, focus, a hidden tab, off screen, and with reduced motion. Adds a pause button |
| `priority` | `boolean` | `false` | The first photo is above the fold: load it at once |
| `lazyMargin` | `string` | `"100px"` | How near the screen before the other photos load |
| `reducedMotion` | `"system" \| "always" \| "never"` | `"system"` | Reduced motion: steps jump, no autoplay |
| `announce` | `boolean` | `true` | Announce changes through a polite live region |

Returns `{ index, el, go(i, smooth?), next(), prev(), play(), pause(), image(i), destroy() }`.

## unfurl (the lightbox)

`unfurl(options)` opens the lightbox and returns its controls. It closes itself (Escape, the close button, a tap, or a pull down).

| Option | Type | Default | |
| --- | --- | --- | --- |
| `photos` | `(UnfurlPhoto \| string)[]` | required | `{ src, alt?, caption? }`, or a plain `src` |
| `start` | `number` | `0` | Photo to open on |
| `origin` | `(i) => Element \| DOMRect \| null` | | Where photo i sits on the page. Null, or off screen, means it fades instead |
| `effect` | `string \| Effect` | `"displacement"` | `"displacement"`, `"ripple"`, `"fade"`, `"zoom"`, `"none"`, a registered name, or your own shader |
| `renderer` | `"auto" \| "webgl" \| "css"` | `"auto"` | Auto uses WebGL where it is there, else CSS. CSS never touches WebGL |
| `reducedMotion` | `"system" \| "always" \| "never"` | `"system"` | Reduced motion: a short fade, no spring, no effect |
| `label` | `string` | `"Photos"` | Shorthand for `labels.dialog` |
| `labels` | `Partial<UnfurlLabels>` | English | Every string, for translation (below) |
| `focusTrap` | `boolean` | `true` | Keep Tab inside the dialog (and mark it aria-modal) |
| `returnFocus` | `boolean \| HTMLElement` | `true` | On close, focus goes back where it was, to this element, or nowhere |
| `announce` | `boolean` | `true` | Read each photo out through a polite live region |
| `hideOrigin` | `boolean` | `true` | Hide the origin element while its photo is out |
| `radius` | `number` | `16` | Corner radius of the photo in its spot (match your thumbnails) |
| `openRadius` | `number` | `12` | Corner radius when open |
| `container` | `HTMLElement` | `document.body` | Where the dialog mounts and its events are dispatched |

Returns `{ index, renderer, next(), prev(), show(i), close(), destroy() }`.

Also exported: `supported()` (is there WebGL), `registerEffect(name, effect)`, `checkEffect(effect)` (compile a shader up front; returns null or the compiler message), and `effectNames()`.

### Renderers

| | WebGL | CSS |
| --- | --- | --- |
| Open and close | A spring from the spot, on a canvas | The same spring with FLIP: the layer moves and scales, the photo scales back so it never stretches. Transform and opacity only, `will-change` while moving |
| Between photos | The effect's shader | The effect's CSS stand-in: fade, slide, zoom or cut |
| Needs | WebGL 1, and photos that are same-origin or sent with CORS headers | Nothing |

With `renderer: "auto"`, a photo WebGL cannot draw (no CORS headers, or it failed to load) and a shader that will not compile both switch to CSS and fire `onError`. Nothing fails silently and the screen is never blank.

## Hooks and events

Every hook is also dispatched as a bubbling DOM `CustomEvent` named `frankaa:<kebab-case>`, with the same detail. Slider events fire on the slider's element; lightbox events fire on its `container` (default `document.body`). Both bubble to `document`.

| Hook | Event | Part | Detail |
| --- | --- | --- | --- |
| `onOpenStart` | `frankaa:open-start` | lightbox | `{ index }` |
| `onOpenEnd` | `frankaa:open-end` | lightbox | `{ index, renderer }` |
| `onCloseStart` | `frankaa:close-start` | lightbox | `{ index }` |
| `onCloseEnd` | `frankaa:close-end` | lightbox | `{ index }`, after it has left the page |
| `onChange` | `frankaa:change` | both | hook gets `(index, { index, from, how })` |
| `onSlideChange` | `frankaa:slide-change` | slider | hook gets `(index, { index, from })` |
| `onAnimationStart` | `frankaa:animation-start` | both | `{ type, index }`, type `"open"`, `"close"`, `"change"` or `"slide"` |
| `onAnimationEnd` | `frankaa:animation-end` | both | as above; every start has an end |
| `onError` | `frankaa:error` | both | `{ index, src, reason, fallback, message? }`, reason `"cors"`, `"load"`, `"webgl"` or `"shader"` |
| `onSelect` | | slider | `(index, img)`, a click or Enter on the photo showing |

```js
document.addEventListener("frankaa:error", (e) => console.warn(e.detail.reason, e.detail.message));
```

## Labels and other languages

Every string can be replaced. `{n}` and `{total}` are filled in.

| Lightbox `labels` | Default | Slider `labels` | Default |
| --- | --- | --- | --- |
| `dialog` | `Photos` | `region` | `Photos` |
| `close` | `Close` | `hint` | `use the arrow keys to move` |
| `next` | `Next photo` | `next` | `Next photo` |
| `previous` | `Previous photo` | `previous` | `Previous photo` |
| `position` | `Photo {n} of {total}` | `position` | `Photo {n} of {total}` |
| `counter` | `{n} / {total}` | `pause`, `play` | `Pause slideshow`, `Play slideshow` |

```js
unfurl({ photos, labels: { dialog: "Fotos", close: "Cerrar", next: "Siguiente", previous: "Anterior", position: "Foto {n} de {total}" } });
```

## Your own shaders

An effect is a GLSL ES 1.0 fragment shader. The built-ins use the same contract, so they double as examples (see `src/effects.ts`).

```js
import { registerEffect, unfurl } from "frankaa";

registerEffect("wipe", {
  duration: 600,                 // ms, default 480
  easing: "ease-out",            // "ease-out" (default), "ease-in-out", "linear" or (t) => number
  css: "slide",                  // what the CSS renderer does instead: "fade" (default), "slide", "zoom", "none"
  uniforms: { uSoftness: 0.08 }, // a number is a float, an array of 2 to 4 numbers a vec2 to vec4
  fragment: `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform float uProgress;
uniform float uSoftness;
uniform vec2 uResolution;
uniform vec2 uFromSize;
uniform vec2 uToSize;
void main() {
  vec4 a = texture2D(uFrom, coverUv(vUv, uFromSize, uResolution));
  vec4 b = texture2D(uTo, coverUv(vUv, uToSize, uResolution));
  gl_FragColor = mix(b, a, smoothstep(uProgress - uSoftness, uProgress + uSoftness, vUv.x));
}`,
});

unfurl({ photos, effect: "wipe" });
// or pass it inline: unfurl({ photos, effect: { fragment, uniforms } })
```

| Input | Type | |
| --- | --- | --- |
| `vUv` | `varying vec2` | 0 to 1 across the photo's box, (0, 0) at its top left |
| `uFrom`, `uTo` | `sampler2D` | The photo leaving and the photo arriving |
| `uProgress` | `float` | 0 to 1, already eased |
| `uResolution` | `vec2` | The box in device pixels |
| `uFromSize`, `uToSize` | `vec2` | Each photo's natural size in pixels |
| `uTime` | `float` | Seconds since the lightbox opened |
| `uDirection` | `float` | +1 for next, -1 for previous |
| your `uniforms` | `float` to `vec4` | Declare them in the shader with the same names |

- Start with `precision mediump float;` and write to `gl_FragColor`.
- Two macros are defined before your code: `coverUv(uv, texSize, resolution)` gives a cover-fitted texture coordinate, and `mirrorUv(uv)` mirrors a coordinate back into 0 to 1 so a shifted sample never smears the edge.
- The lightbox clips your output to the rounded box and handles the open and close spring; the shader only draws the change between two photos.
- A shader that does not compile fires `onError` with `reason: "shader"` and the compiler's message, and the lightbox shows with CSS instead. `checkEffect(effect)` compiles it ahead of time; line numbers count from your first line.
- With reduced motion, every effect becomes a plain fade.

## Styling

`frankaa/style.css` puts every rule inside `:where()`, so any rule of yours wins. Theme with custom properties: `--fk-radius`, `--fk-placeholder`, `--fk-dot`, `--fk-dot-on`, `--fk-arrow-bg`, `--fk-arrow-ink`, `--fk-focus`, `--fk-backdrop`, `--fk-ease`, `--fk-z`.

## Accessibility

- The slider is a labelled carousel region with one tab stop. Arrow keys, Home and End move; Enter selects. Autoplay is off by default, pauses on hover and focus, and has a pause button.
- The lightbox is a dialog. Focus moves to the close button, Tab stays inside, and focus goes back on close. Left and Right move, Home and End jump to the first and last photo, Escape closes. A key move puts a clear focus ring on the matching arrow button. Each photo's position and alt text are announced.
- Reduced motion follows the system, or set `reducedMotion` to `"always"` or `"never"`.

## Motion

- Open and close are critically damped springs: no bounce, about 250 ms to cover 95% of the way in and 220 ms out, so the exit is quicker than the entrance.
- Gestures follow the finger 1:1 with no easing: sideways to change photo, down to close (the backdrop fades with the pull), up with resistance. On release the spring carries on from the finger's velocity, and the photo can be caught again mid-animation.
- A short fast flick counts; a drag released while heading back springs back.
- Photo changes default to ease-out (no slow start on something the person triggered). In the CSS renderer they stay under 300 ms.
- Buttons press to scale .97. Hover and fades use `cubic-bezier(.23, 1, .32, 1)`.
- Reduced motion: no spring, no effect, a short fade; finger tracking stays, since the person is making that motion.

## Security, CSP and CORS

- No `eval`, no `new Function`, no `innerHTML`. Captions and labels go in with `textContent`, and icons are built node by node, so it works under a strict Content Security Policy, including Trusted Types.
- Inline styles are set through the CSSOM (`element.style`), which `style-src` without `'unsafe-inline'` allows.
- CSP needs: `img-src` must allow your photos. WebGL textures are made from plain image elements, so no `blob:` or `data:` source is needed unless your photos use those URLs.
- CORS: WebGL can only read a cross-origin photo sent with `Access-Control-Allow-Origin`. frankaa loads photos with `crossOrigin="anonymous"`, so a photo without the header fails to load rather than tainting the canvas; the lightbox then shows it with CSS and fires `onError` with `reason: "cors"`. To keep WebGL for photos on a CDN, send `Access-Control-Allow-Origin: *` (or your origin) on them, or use `renderer: "css"`.
- Custom shaders run on the GPU inside your page. They have no network or DOM access, but only use shaders you trust.
- Report vulnerabilities privately: see [SECURITY.md](SECURITY.md).

## Browser support

Current Chrome, Edge, Firefox and Safari (desktop and mobile), and anything with CSS scroll snap and ES2020. WebGL 1 is used where it is there; the CSS renderer works everywhere else. The slider's focus ring uses `:has()`; without it the slider still works.

## Size

Minified and gzipped, each with the code it pulls in:

| Import | Size |
| --- | --- |
| `frankaa/slider` | 3.3 kB |
| `frankaa/lightbox` | 9.7 kB |
| `frankaa` (both) | 11.5 kB |
| `frankaa/react` (both, with bindings) | 12.0 kB |
| `frankaa/style.css` | 1.6 kB |

## Using frankaa with AI

- [`llms.txt`](llms.txt): a short index of the API, options and hooks.
- [`llms-full.txt`](llms-full.txt): the full reference and copy-paste recipes (vanilla, React, Next.js, gallery grid, slider card, CSS renderer, reduced motion, labels, events, custom shaders).
- [`AGENTS.md`](AGENTS.md): how an agent should integrate frankaa, the decision rules, pitfalls and a checklist.
- [`skills/frankaa/SKILL.md`](skills/frankaa/SKILL.md): a Claude Code skill. Copy the folder into `.claude/skills/`.
- [`.cursor/rules/frankaa.mdc`](.cursor/rules/frankaa.mdc): Cursor rules.

The llms files, AGENTS.md and the skill ship inside the npm package too, under `node_modules/frankaa/`.

## Development

```sh
npm install
npm run build      # dist/ and docs/lib/, with a size report
npm test           # node --test, needs Node 22.18 or later
npm run typecheck
npm run check:keys # browser keyboard check; needs Playwright (see the script's header)
```

The docs page is `docs/index.html`; serve the folder and open it.

## Releasing

Releases publish from GitHub Actions with npm trusted publishing (OIDC) and provenance, so no npm token is stored anywhere. The owner links the package to this repository once:

1. Publish the first version by hand, or create the package on npmjs.com, so the name `frankaa` exists under your account.
2. On npmjs.com, open the package, then Settings, then Trusted publishing, and add a GitHub Actions publisher: organisation or user `JABClari`, repository `frankaa`, workflow file `release.yml`, no environment.
3. In the same settings, set publishing access to require two-factor authentication and disallow tokens.
4. To release: bump `version` in package.json, commit, tag `vX.Y.Z`, push the tag, then publish a GitHub release for it. The workflow tests, builds and runs `npm publish`; npm attaches the provenance statement.

## Credits

Made by Sirius Arc, built by Joshua. The slider comes from B-Immo's listing cards and the lightbox from Piku's listing pages.

Photos on the docs page are CC0; sources are listed in `docs/photos/CREDITS.txt`.

## Licence

MIT. See [LICENSE](LICENSE).
