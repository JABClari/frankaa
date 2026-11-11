<p><img src="brand/frankaa-logo.svg" alt="frankaa" width="300" height="64"></p>

# frankaa

Said FRAN-kah.

Along the Fante coast of Ghana, each Asafo company has its frankaa: flags of bold appliqué, pictures cut from coloured cloth and sewn onto a field. At festivals they are carried one after another in procession, then unfurled so the whole picture can be seen.

This package is named after them, and has two parts:

- **procession**, a photo slider. A native scroll-snap track, so a swipe follows the finger 1:1 and keeps its momentum. Dots follow the scroll, arrows show on hover with a mouse, and photos past the first load only when the slider comes near the screen.
- **unfurl**, a photo lightbox. The photo lifts out of its spot and springs to full view on a WebGL canvas, moves to the next photo with a displacement crossfade, swipes, and springs back to its spot when closed.

Plain TypeScript with no dependencies, and thin optional React bindings.

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
      origin: (n) => slider.image(n),   // spring from, and back to, the slider's photo
      onChange: (n) => slider.go(n, false), // keep the slider on the photo being shown
    }),
});
```

Each part can be imported on its own: `frankaa/slider` and `frankaa/lightbox`.

### React

```jsx
import { useRef } from "react";
import { Procession, useUnfurl } from "frankaa/react";
import "frankaa/style.css";

function Card({ photos }) {
  const slider = useRef(null);
  const lightbox = useUnfurl(photos, {
    origin: (n) => slider.current?.image(n) ?? null,
    onChange: (n) => slider.current?.go(n, false),
  });
  return <Procession ref={slider} photos={photos} label="Sea terrace" onSelect={(i) => lightbox.open(i)} />;
}
```

## API

### `procession(element, options)`

Turns an element into a slider and returns its controls. The element keeps its own children; the slider adds a track, dots and arrows. It is 4:3 by default; size it with CSS.

| Option | Type | Default | |
| --- | --- | --- | --- |
| `photos` | `(Photo \| string)[]` | required | `{ src, srcset?, sizes?, alt?, width?, height? }`, or a plain `src` |
| `label` | `string` | `"Photos"` | Accessible name of the slider |
| `start` | `number` | `0` | Photo to start on |
| `dots` | `boolean` | `true` | Show the dots |
| `arrows` | `boolean` | `true` | Show the arrows on hover (mouse only) and on keyboard focus |
| `priority` | `boolean` | `false` | The first photo is above the fold: load it at once |
| `lazyMargin` | `string` | `"100px"` | How near the screen before the other photos load |
| `onChange` | `(index) => void` | | The photo showing changed |
| `onSelect` | `(index, img) => void` | | Click or Enter on the photo showing |

Returns `{ index, el, go(i, smooth?), next(), prev(), image(i), destroy() }`.

### `unfurl(options)`

Opens the lightbox and returns its controls. It closes itself (Escape, the close button, a tap, or a pull down) and then calls `onClose`.

| Option | Type | Default | |
| --- | --- | --- | --- |
| `photos` | `(UnfurlPhoto \| string)[]` | required | `{ src, alt?, caption? }`, or a plain `src` |
| `start` | `number` | `0` | Photo to open on |
| `origin` | `(i) => Element \| DOMRect \| null` | | Where photo i sits on the page. Null, or off screen, means it fades instead |
| `label` | `string` | `"Photos"` | Accessible name of the dialog |
| `hideOrigin` | `boolean` | `true` | Hide the origin element while its photo is out |
| `radius` | `number` | `16` | Corner radius of the photo in its spot (match your thumbnails) |
| `openRadius` | `number` | `12` | Corner radius when open |
| `webgl` | `boolean` | `true` | Set false to always show a plain image |
| `container` | `HTMLElement` | `document.body` | Where the dialog mounts |
| `onChange` | `(index, how) => void` | | `how` is `"key"`, `"button"` or `"swipe"` |
| `onClose` | `(index) => void` | | The dialog has closed and left the page |

Returns `{ index, mode, next(), prev(), close(), destroy() }`. `mode` is `"gl"` or `"dom"`.

`supported()` tells you whether the browser has WebGL.

WebGL reads the photos as textures, so they must be same-origin or served with CORS headers. If a photo cannot be drawn, the lightbox shows it as a plain image instead.

### React: `frankaa/react`

- `<Procession {...procession options} className style ref />`. The ref gives the slider's controls. The slider is rebuilt only when the photo sources change.
- `useUnfurl(photos, options)` returns `{ open(start), close() }`. Callbacks always see the latest props, and the lightbox closes on unmount.

React 18 or later is an optional peer dependency.

### Styling

`frankaa/style.css` puts every rule inside `:where()`, so any rule of yours wins. Theme with custom properties:

`--fk-radius`, `--fk-placeholder`, `--fk-dot`, `--fk-dot-on`, `--fk-arrow-bg`, `--fk-arrow-ink`, `--fk-focus`, `--fk-backdrop`, `--fk-ease`, `--fk-z`.

## Accessibility

- The slider is a labelled carousel region with one tab stop. Arrow keys, Home and End move; Enter selects. Changes are announced politely.
- The lightbox is a modal dialog. Focus moves to the close button, Tab stays inside, and focus goes back where it was on close. Arrow keys move, Escape closes, and each photo's position and alt text are announced.
- With reduced motion, the spring and crossfade become a short fade, and the slider steps without smooth scrolling.

## Browser support

Current Chrome, Edge, Firefox and Safari (desktop and mobile), and anything with CSS scroll snap and ES2020. The lightbox uses WebGL 1 where it is there and a plain image where it is not. The focus ring on the slider uses `:has()`; without it the slider still works.

## Size

Minified and gzipped, each with the code it pulls in:

| Import | Size |
| --- | --- |
| `frankaa/slider` | 1.8 kB |
| `frankaa/lightbox` | 5.1 kB |
| `frankaa` (both) | 6.4 kB |
| `frankaa/react` (both, with bindings) | 6.8 kB |
| `frankaa/style.css` | 1.5 kB |

## Development

```sh
npm install
npm run build      # dist/ and docs/lib/, with a size report
npm test           # node --test, needs Node 22.18 or later
npm run typecheck
```

The docs page is `docs/index.html`; serve the folder and open it.

## Credits

Made by Sirius Arc, built by Joshua. The slider comes from B-Immo's listing cards and the lightbox from Piku's listing pages.

Photos on the docs page are CC0; sources are listed in `docs/photos/CREDITS.txt`.

## Licence

MIT. See [LICENSE](LICENSE).
