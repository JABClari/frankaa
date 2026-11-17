<p><img src="brand/frankaa-logo.svg" alt="frankaa" width="300" height="64"></p>

# frankaa

Said FRAN-kah.

Along the Fante coast of Ghana, each Asafo company has its frankaa: flags of bold appliqué, pictures cut from coloured cloth and sewn onto a field. At festivals they are carried one after another in procession, then unfurled so the whole picture can be seen.

This package is named after them, and has three parts:

- **procession**, a photo slider. A native scroll-snap track, so a swipe follows the finger 1:1 and keeps its momentum. Dots, arrows on hover, lazy loading, and optional loop and autoplay.
- **unfurl**, a photo lightbox. The photo lifts out of its spot and springs to full view, moves to the next photo with an effect, and springs back when closed. WebGL shader effects (built-in or your own) or a CSS renderer that uses transform and opacity only.
- **drumline (dondo, the talking drum)**, a strip of pictures under a ruler of ticks. Drag, flick, wheel either way or run along the ruler; the picture in focus grows and a tap opens it in the lightbox. It also sits under the lightbox as its filmstrip.

All three take the same list of items, and combining them is one option. Plain TypeScript with no dependencies, and thin optional React bindings. Live demo and playground: https://jabclari.github.io/frankaa/

## Install

```sh
npm install frankaa
```

## One list for every part

Every part takes the same items, as the first argument after the element (`procession(el, items, options)`, `drumline(el, items, options)`, `unfurl(items, options)`) or as `items` in the options. Each picks the file it needs.

| Field | Used by | |
| --- | --- | --- |
| `src` | the slider, and the others when nothing else is set | The picture. A plain string is taken as `src` |
| `thumb` | drumline, the lightbox's filmstrip | A small file |
| `full` | the lightbox | A large file |
| `srcset`, `sizes` | the slider (and the lightbox when there is no `full`) | Sizes of `src` |
| `sources` | the slider | Art direction: `[{ media, srcset, sizes?, type? }]`, drawn as `<picture>` |
| `alt`, `caption`, `title` | all | |
| `width`, `height` | the slider | So nothing shifts while it loads |
| `placeholder` | all | A colour, or an image address (a tiny thumbnail or a decoded blurhash) |

Videos are `{ type: "video", provider, src, poster? }` (below). Without a poster, an mp4 shows its first frame in the lightbox, and a neutral 16:9 still stands in elsewhere.

```js
const items = [
  { src: "/terrace-800.jpg", full: "/terrace-2000.jpg", thumb: "/terrace-200.jpg", alt: "Terrace" },
  "/pool.jpg",
];
procession(card, items);
unfurl(items, { start: 1, strip: "ruler" }); // the lightbox with a drumline filmstrip
drumline(strip, items, { preset: "numbers" });
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

`<Drumline items={items} preset="ruler" />` is the strip, and `useUnfurl(items, { strip: "ruler" })` gives the lightbox its filmstrip. Unmounting a component closes its lightbox without firing `onCloseStart` or `onCloseEnd` (it fires `onDestroy`), and React StrictMode's practice unmount in development does nothing, so a lightbox opened on mount stays open.

The bindings are safe to import during server rendering: nothing touches the DOM until an effect runs. In the Next.js App Router, use them from a client component as above.

Your own React controls in the top bar keep your context through a portal; render `lightbox.portal` anywhere:

```jsx
const lightbox = useUnfurl(photos, {
  renderControls: (api) => <button type="button" className="fk-unfurl-action" onClick={() => remove(api.index)}>Remove this page</button>,
});
return <>{grid}{lightbox.portal}</>;
```

`react-dom` is an optional peer dependency, used only for that portal.

`<Procession>` renders its first photo on the server, so the first paint is never empty; the slider keeps it until its own photo has decoded.

### React Native

`frankaa/native` is the same three parts for React Native and Expo, on the same items, labels and motion math as the web. It needs React Native 0.78 or later with the New Architecture, `react-native-reanimated` 4 with `react-native-worklets`, and `react-native-gesture-handler` 2 (all optional peer dependencies; the web bundles carry none of it). Wrap the app in `GestureHandlerRootView` once.

```tsx
import { useRef, useState } from "react";
import * as Haptics from "expo-haptics";
import { Drumline, Procession, Unfurl, useOrigins, type UnfurlHandle } from "frankaa/native";
import { skiaUnfurl } from "frankaa/native/skia"; // only with @shopify/react-native-skia

const haptics = (k: "selection" | "light") =>
  k === "light" ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light) : Haptics.selectionAsync();

export function ProductPhotos({ items }) {
  const [index, setIndex] = useState(0);
  const origins = useOrigins();
  const lightbox = useRef<UnfurlHandle>(null);
  return (
    <>
      <Procession items={items} index={index} onChange={setIndex} origins={origins} onPress={(i) => lightbox.current?.open(i)} haptics={haptics} />
      <Drumline items={items} preset="minimal" index={index} onChange={setIndex} haptics={haptics} />
      <Unfurl ref={lightbox} items={items} index={index} onChange={setIndex} origins={origins} strip="ruler"
        renderer={skiaUnfurl} haptics={haptics}
        actions={(api) => <MyButton label="Make cover" onPress={() => makeCover(api.index)} />} />
    </>
  );
}
```

- **Procession**: the photos follow the finger 1:1 with the next one peeking in (`peek`, `gap`, `aspectRatio`, `radius`), rubber-band at the ends, and spring to the photo the flick was heading for, carrying its speed. `onPress` is a tap on the photo in view.
- **Drumline**: tall cards over a ruler of ticks (`preset`: `"ruler"`, `"numbers"`, `"minimal"`, and every look option). The position eases toward its target every frame on the UI thread (`fluid: "lerp"`; `"chain"` and `"bend"` move as `"lerp"` here, `"off"` is a spring); a flick is projected on. Tap a card to select it (`onSelect`); drag along the ruler to run through the pictures.
- **Unfurl**: opens from the measured spot of the photo you tapped (`origins`, shared through `useOrigins()`) and grows to fit in 360 ms on the iOS sheet curve; it closes in 220 ms with a strong ease-out back to the spot, wherever it is by then. Swipe sideways for the next photo, pull down to close (a flick is enough), tap to close. `strip` adds the drumline filmstrip, `actions` and `topActions` are slots that get `{ index, item, close, next, prev, show }`. The ref has `open(i)`, `close()`, `next()`, `prev()`, `show(i)`.
- **Keeping them in step**: give every part the same `index` and `onChange`; a part never echoes back a change it reported.
- **The shader**: `frankaa/native/skia` draws the photo in flight with the unfurl shader (the web's rounded box, with a soft ripple on the way) on a Skia `RuntimeEffect`. Without it, or until its image has loaded, the photo is plain views moved with transforms.
- **Motion and access**: only transform and opacity animate, all on the UI thread, and reduced motion (`reducedMotion`, default `"system"`) makes the lightbox a crossfade and the strips step. `haptics` gets `"selection"` per photo and `"light"` when a close commits. Each strip is one adjustable element (swipe up or down to move, double tap to open) with the same labels as the web (`labels`); the lightbox close button is 44 pt.
- **Images**: React Native's `Image` by default; `renderImage={({ uri }) => <ExpoImage source={uri} style={StyleSheet.absoluteFill} contentFit="cover" />}` swaps in your own. Pass `width` and `height` on items so the lightbox knows each photo's shape before it loads. Pass `insets` (for example from `useSafeAreaInsets()`) so the bars clear the notch and the home indicator.

## procession (the slider)

`procession(element, items, options)` (or `procession(element, { items, ...options })`) turns an element into a slider and returns its controls. The element keeps its own children. It is 4:3 by default; size it with CSS.

| Option | Type | Default | |
| --- | --- | --- | --- |
| `photos` | `(Photo \| string)[]` | required | `{ src, srcset?, sizes?, alt?, width?, height?, placeholder? }`, or a plain `src`. `placeholder` is a colour or an image address (a tiny thumbnail, or a blurhash you decoded to a data URL) shown until the photo paints |
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
| `preload` | `"near" \| "idle" \| false` | `"near"` | When the other photos load: near the screen; also the next one when the page is idle; or only when touched or moved |
| `reducedMotion` | `"system" \| "always" \| "never"` | `"system"` | Reduced motion: steps jump, no autoplay |
| `announce` | `boolean` | `true` | Announce changes through a polite live region |
| `href` | `string` | | Make the slider a link (the track is an `<a href>`), so Cmd, Ctrl and middle click open it as usual |
| `tabbable` | `boolean` | `true` | False takes the slider out of the tab order, when another link on the card already takes focus |
| `counter` | `boolean` | `false` | Show a "2 / 5" counter (`labels.counter`) |
| `zoom` | `boolean` | `false` | Pinch toward the fingers (springs back on release) and double tap to zoom in and out |
| `zoomCursor` | `boolean` | `false` | The zoom-in cursor, for a slider that opens a lightbox |
| `focusRing` | `"outside" \| "inset"` | `"outside"` | Inset draws the ring inside, for sliders in a parent with `overflow: hidden` |
| `icons` | `{ prev?, next?, play?, pause? }` | | Your icons, as the `d` of a 24px stroked path |

Returns `{ index, el, go(i, smooth?), next(), prev(), play(), pause(), image(i), destroy() }`.

`onSelect(index, img, event)` gets the event, so you can leave modified clicks to the browser or call `preventDefault()`. With `zoom`, a single touch tap waits a moment to tell it from a double tap.

## drumline (the strip)

`drumline(element, items, options)` turns an element into the strip and returns its controls. A preset sets its look; every setting can also be given on its own, and wins over the preset.

| Preset | Ticks | Numbers | Cards | Fluid | Colour focus |
| --- | --- | --- | --- | --- | --- |
| `"ruler"` (default) | yes, hover runs through | no | tall story cards, grow 1.55 | `"bend"` | yes |
| `"numbers"` | yes | the frame, "28 [29] 30" | narrow tall bars, grow 1.3 | `"chain"` | no |
| `"minimal"` | no | "06 / 24" under the strip | story cards, grow 1.18 | `"lerp"` | no |

| Option | Type | Default | |
| --- | --- | --- | --- |
| `preset` | `"ruler" \| "numbers" \| "minimal"` | `"ruler"` | Starting point for the look |
| `ticks` | `boolean` | preset | The ruler of ticks |
| `rulerHover` | `boolean` | preset | Hovering the ruler with a mouse moves through the pictures (dragging on it always does, touch too) |
| `numbers` | `"frame" \| "fraction" \| false` | preset | The number readout; `pad` sets the digits (2) |
| `focusFeedback` | `boolean` | preset | Ticks near the focus lift and brighten; cards away from it dim a little |
| `colorFocus` | `boolean` | preset | Pictures away from the focus lose a little colour and light (lightly) |
| `grow` | `number` | preset | How much the picture in focus grows (1 = not at all) |
| `fluid` | `"off" \| "lerp" \| "chain" \| "bend"` | preset | How it moves (below) |
| `look` | `"stories" \| "bars"` | preset | Card shape; size with `--fk-dl-w`, `--fk-dl-h`, `--fk-dl-gap`, `--fk-dl-card-radius` |
| `renderer` | `"auto" \| "dom"` | `"auto"` | For `"bend"`: WebGL where it can, or always the DOM |
| `wheel` | `"both" \| "x" \| "y" \| false` | `"both"` | Which wheel axis moves it; at either end the page scrolls on |
| `drag`, `inertia`, `snap` | `boolean` | `true` | Drag it; a flick carries on; it rests on a picture |
| `expand` | `boolean` | `true` | A tap or Enter opens the picture in the lightbox (loaded on first use) |
| `lightbox` | unfurl options | | For that lightbox, for example `{ effect: "ripple", strip: "minimal" }` |
| `start`, `label`, `labels`, `reducedMotion`, `announce` | | | As in the other parts |

Fluid modes:

- `"off"`: a critically damped spring, 1:1 under the finger.
- `"lerp"`: the position eases toward its target every frame, trailing the finger a touch; a flick decays smoothly (about 7% less speed a frame) with no overshoot.
- `"chain"`: lerp, and each card eases toward the strip at its own rate, nearer the middle first.
- `"bend"`: lerp, and speed bulges the strip around its middle so the cards' tops and bottoms trace a curve, flattening as it slows. Drawn in WebGL; it uses the DOM instead when WebGL is missing, when pictures are cross-origin without CORS headers, or when frames run under about 50 fps, and fires `onError` (`reason: "webgl" | "cors" | "slow"`, `fallback: "dom"`).

Returns `{ index, renderer, el, go(i, smooth?), next(), prev(), expand(i?), image(i), destroy() }`. Hooks: `onChange(index, { from, how })` (`how` is `"drag"`, `"wheel"`, `"ruler"`, `"key"`, `"tap"` or `"api"`), `onAnimationStart` and `onAnimationEnd` (`type: "scroll"`), `onSelect(index, img, event)`, `onExpand({ index })`, `onError`. Keys: Left, Right, Home, End and Enter; one card is in the tab order and focus moves with it.

## unfurl (the lightbox)

`unfurl(items, options)` (or `unfurl({ items, ...options })`) opens the lightbox and returns its controls. It closes itself (Escape, the close button, a tap, or a pull down).

| Option | Type | Default | |
| --- | --- | --- | --- |
| `photos` | `(UnfurlItem \| string)[]` | required | Images `{ src, srcset?, sizes?, alt?, caption?, placeholder? }` (or a plain `src`) and videos (below), mixed |
| `topActions` | `{ label, onClick(api), icon? }[]` | | Extra buttons in the top bar, before Close, inside the focus trap. `icon` is a 24px path `d` |
| `controls` | `(host, api) => cleanup?` | | Mount your own controls in the top bar; return a function to tidy up |
| `start` | `number` | `0` | Photo to open on |
| `origin` | `(i) => Element \| DOMRect \| null` | | Where photo i sits on the page. Null, or off screen, means it fades instead |
| `loop` | `boolean` | `false` | Wrap from the last photo to the first. Off: the ends rubber-band and the arrow there is marked unavailable |
| `effect` | `string \| Effect` | `"displacement"` | `"displacement"`, `"ripple"`, `"fade"`, `"zoom"`, `"none"`, a registered name, or your own shader |
| `loading` | `"film" \| "frost" \| "liquid" \| "none" \| LoadingShader \| LoadingRender` | `"film"` | What a photo shows while it loads (below) |
| `loadingDelay` | `number` | `250` | ms before the loading ring and the "Loading photo" label, so fast loads never show them |
| `renderer` | `"auto" \| "webgl" \| "css"` | `"auto"` | Auto uses WebGL where it is there, else CSS. CSS never touches WebGL |
| `swipe` | `"effect" \| "strip"` | `"effect"` | With WebGL, a sideways swipe runs the effect under the finger (its progress follows the drag, then finishes or rewinds on release). `"strip"` slides the photos side by side. CSS always slides |
| `reducedMotion` | `"system" \| "always" \| "never"` | `"system"` | Reduced motion: a short fade, no spring, no effect |
| `label` | `string` | `"Photos"` | Shorthand for `labels.dialog` |
| `labels` | `Partial<UnfurlLabels>` | English | Every string, for translation (below) |
| `focusTrap` | `boolean` | `true` | Keep Tab inside the dialog (and mark it aria-modal) |
| `returnFocus` | `boolean \| HTMLElement` | `true` | On close, focus goes back where it was, to this element, or nowhere |
| `announce` | `boolean` | `true` | Read each photo out through a polite live region |
| `hideOrigin` | `boolean` | `true` | Hide the origin element while its photo is out |
| `radius` | `number \| [tl, tr, br, bl] \| (i) => ...` | `16` | Corner radius of the photo in its spot (match your thumbnails); four corners, or per photo for grids whose tiles differ |
| `openRadius` | `number \| [tl, tr, br, bl]` | `12` | Corner radius when open |
| `zoom` | `boolean \| { max }` | `true` | Pinch, double tap or double click, Ctrl or trackpad pinch, and the + and - keys zoom; one finger or the mouse pans while zoomed. `max` defaults to 4 |
| `icons` | `{ prev?, next?, close?, play? }` | | Your icons, as the `d` of a 24px stroked path |
| `container` | `HTMLElement` | `document.body` | Where the dialog mounts and its events are dispatched |
| `strip` | `true \| "ruler" \| "numbers" \| "minimal" \| drumline options` | | A drumline filmstrip along the bottom. A tap or a key moves the photo at once; while it is scrubbed, the photo follows when it pauses |

Returns `{ index, renderer, next(), prev(), show(i), close(), destroy() }`. `destroy()` removes it at once; if it was still open it fires `onCloseStart` and `onCloseEnd` with `reason: "destroy"`, and ends any running animation with `cancelled: true`.

The `api` that actions and controls get is `{ index, item, close(), next(), prev(), show(i) }`.

Also exported: `supported()` (is there WebGL), `registerEffect(name, effect)`, `checkEffect(effect)` (compile a shader up front; returns null or the compiler message), `checkLoading(shader)` (the same for a loading shader), `registerLoading(name, shader)`, `loadingNames()` and `effectNames()`.

### Loading

Opening and moving never wait for the photo. If it is not ready, the lightbox springs open from the tile, or moves, (with the effect) to the best picture it already has, the photo's `placeholder` image or its thumbnail (`thumb`, else `src`, usually in the browser's cache from the grid or the filmstrip), in the photo's shape, with a loading material over it. A small ring comes in at the bottom right after `loadingDelay` (250 ms), so fast loads never show it, and screen readers hear "Loading photo 3". When the photo has decoded it dissolves in, in place, and the ring completes and fades.

- Opening: the spring from the tile, its radius and the lifted tile are the same as for a photo that is already there; a photo in the cache opens straight to itself.
- No preview: an empty frame in the photo's shape (from `width` and `height` when given, else the box before it) with the material on a neutral base. Never the old photo.
- Failure: the material dims and the frame says "This photo didn't load" with a Retry button. `onError` fires as before (`reason: "load"`, `fallback: "none"`).
- Quick taps: only the latest move changes the picture. A filmstrip jump loads that photo and its neighbours at once.
- Videos keep their poster behaviour.

| `loading` | WebGL | CSS |
| --- | --- | --- |
| `"film"` (default) | An iridescent thin-film sheen drifting over the frosted preview | The film on a neutral frame, transform only (no photo under it) |
| `"frost"` (with `frankaa/loading`) | Etched glass with a slow band of light refracting through it | The film |
| `"liquid"` (with `frankaa/loading`) | The preview flowing under a glossy, domain-warped surface | The film |
| `"none"` | The blurred preview alone | A neutral frame |
| `{ fragment, uniforms }` | Your shader | The film |
| `(host, state) => cleanup` | Your view over the blurred preview | Your view over a neutral frame |

```js
unfurl(items, { loading: "film", loadingDelay: 400 }); // "film" and "none" are built in

// frost and liquid live in their own entry, so the lightbox carries only the film. Importing it registers them
// (like registerEffect); or pass the objects.
import { liquid } from "frankaa/loading";
unfurl(items, { loading: "frost" });
unfurl(items, { loading: liquid });

// Your own material (WebGL): the same spirit as effects.
unfurl(items, {
  loading: {
    uniforms: { uTint: [0.2, 0.5, 1] },
    fragment: `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uPreview;
uniform float uHasPreview;
uniform float uTime;
uniform float uFailed;
uniform vec3 uTint;
void main() {
  vec3 base = uHasPreview > 0.5 ? texture2D(uPreview, vUv).rgb : vec3(0.15);
  float pulse = 0.5 + 0.5 * sin(uTime * 2.0 + vUv.x * 6.0);
  vec3 col = mix(base, uTint, 0.25 * pulse);
  gl_FragColor = vec4(uFailed > 0.5 ? col * 0.5 : col, 1.0);
}`,
  },
});

// Your own view, in either renderer: drawn over the photo's box; return a function to tidy up.
unfurl(items, {
  loading: (host, { index, failed, retry }) => {
    const p = document.createElement("p");
    p.textContent = failed ? "Not this time." : `Fetching ${index + 1}...`;
    if (failed) p.onclick = retry;
    host.append(p);
    return () => p.remove();
  },
});
```

The loading shader contract: GLSL ES 1.0, `precision mediump float;`, `varying vec2 vUv` (0 to 1 across the box, top left at 0, 0), uniforms `uPreview` (`sampler2D`, the preview already blurred and cropped to the frame), `uHasPreview` (0 or 1), `uTime` (seconds since loading began; still with reduced motion), `uResolution` (the box in device pixels), `uFailed` (0 or 1), plus your own. frankaa clips it to the rounded box and does the reveal itself. A shader that does not compile fires `onError` with `reason: "shader"` and `fallback: "none"`, and the built-in film is used; so does a name nothing registered (the message says when `frankaa/loading` is missing). `registerLoading(name, { fragment, uniforms })` adds your own by name. The material is drawn at no more than one texel per CSS pixel, so keep it cheap anyway.

Reduced motion: the materials stand still, the ring turns slower, and the photo arrives with a short fade.

### Videos

Mix video slides with images. The poster springs from the grid and shows with a play button; the player loads only when the person taps play, and is removed (stopping it) when they move on or close.

```js
unfurl({
  photos: [
    { src: "/img/pool.jpg", alt: "Pool" },
    { type: "video", provider: "youtube", src: "https://youtu.be/dQw4w9WgXcQ", poster: "/img/walk.jpg", title: "Pool walk" },
    { type: "video", provider: "mp4", src: "/media/tour.mp4", poster: "/img/tour.jpg" },
    { type: "video", provider: "tiktok", src: "https://www.tiktok.com/@you/video/7212345678901234567", poster: "/img/tt.jpg" },
  ],
});
```

| Provider | Player | `src` |
| --- | --- | --- |
| `youtube` | `youtube-nocookie.com` privacy embed | a watch, short, embed or youtu.be link, or the id |
| `vimeo` | `player.vimeo.com` with `dnt=1` | a vimeo.com link (unlisted `?h=` kept) or the id |
| `tiktok` | the official embed | a video link or the id |
| `instagram` | the official embed | a post or reel link, or the code |
| `mp4` | `<video playsinline>` with frankaa's own controls | an http(s) or relative file address |

- Give the poster the video's shape: the player takes the poster's box. The poster is optional: an mp4 without one shows its first frame behind the play button, and a neutral 16:9 still stands in elsewhere.
- mp4 controls: play and pause, a seek bar with the time and length, mute with a volume slider (on hover; phones keep the mute button, since they set volume with their own buttons), and full screen. A tap on the video plays or pauses it instead of closing the lightbox. The bar fades out after 2.5 seconds of untouched playback and comes back on any movement or focus. With focus in the player: Space or K plays and pauses, Left and Right seek 5 seconds, J and L seek 10, M mutes, F goes full screen; Escape still closes. Volume and mute carry over to the next video in the same visit. Style it with `--fk-vc-ink`, `--fk-vc-fill`, `--fk-vc-track`, `--fk-vc-buffer` and `--fk-vc-btn`.
- Moving to or from a video uses a short crossfade; the effect runs between image slides.
- Players are sandboxed iframes, and only ids that match each provider's shape are used. A source that does not fit fires `onError` with `reason: "media"`.
- CSP: add the providers you use to `frame-src` (for example `https://www.youtube-nocookie.com https://player.vimeo.com`), and your mp4 host to `media-src`.

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
| `onCloseStart` | `frankaa:close-start` | lightbox | `{ index, reason }`, reason `"close"` or `"destroy"` |
| `onCloseEnd` | `frankaa:close-end` | lightbox | `{ index, reason }`, after it has left the page |
| `onChange` | `frankaa:change` | both | hook gets `(index, { index, from, how })` |
| `onSlideChange` | `frankaa:slide-change` | slider | hook gets `(index, { index, from })` |
| `onAnimationStart` | `frankaa:animation-start` | both | `{ type, index }`, type `"open"`, `"close"`, `"change"` or `"slide"` |
| `onAnimationEnd` | `frankaa:animation-end` | both | as above, plus `cancelled: true` when `destroy()` cut it short; every start has exactly one end |
| `onError` | `frankaa:error` | both | `{ index, src, reason, fallback, message? }`, reason `"cors"`, `"load"`, `"webgl"`, `"shader"` or `"media"` |
| `onLoadStart` | `frankaa:load-start` | lightbox | `{ index }`: a photo is on screen with its loading look (also after Retry) |
| `onLoadEnd` | `frankaa:load-end` | lightbox | `{ index, ok }`: it arrived, or did not load (`onError` fires too) |
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
| `videoPosition` | `Video {n} of {total}` | | |
| `play` | `Play video` | | |
| `pause` | `Pause video` | | |
| `mute`, `unmute` | `Mute`, `Unmute` | | |
| `seek`, `volume` | `Seek`, `Volume` | | |
| `fullscreen`, `exitFullscreen` | `Full screen`, `Exit full screen` | | |
| `timeOf` | `{time} of {duration}` | | |
| `loading` | `Loading photo {n}` | | |
| `failed` | `This photo didn't load` | | |
| `retry` | `Retry` | | |

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

Each base rule in `frankaa/style.css` carries one class (`.fk-...`), so a site's element resets (`button {}`, `img {}`, `svg {}`) and a plain `:focus-visible` rule cannot hide the arrows or recolour the rings, while a rule of yours with the same class, loaded later, still wins. The buttons reset what a `button {}` rule may set.

| Property | Default | |
| --- | --- | --- |
| `--fk-focus` | `#23306b` | Focus ring on the page (slider) |
| `--fk-focus-dark` | `#fff` | Focus ring in the lightbox |
| `--fk-focus-width` | `2px` | |
| `--fk-press-scale` | `.97` | Buttons when pressed |
| `--fk-hover-scale` | `1` | Buttons on hover (mouse) |
| `--fk-font` | `500 13px/1.4 system-ui, ...` | The lightbox's text |
| `--fk-radius`, `--fk-placeholder` | `12px`, `#ece8e1` | The slider's corners and empty colour |
| `--fk-dot`, `--fk-dot-on`, `--fk-dot-shadow` | | Dots |
| `--fk-arrow-bg`, `--fk-arrow-ink`, `--fk-arrow-shadow` | | Slider arrows |
| `--fk-count-bg`, `--fk-count-ink` | | Slider counter |
| `--fk-backdrop`, `--fk-backdrop-blur` | `rgba(12, 12, 14, .94)`, `8px` | Lightbox backdrop |
| `--fk-button-bg`, `--fk-button-bg-hover` | | Lightbox buttons |
| `--fk-ease`, `--fk-z` | `cubic-bezier(.23, 1, .32, 1)`, `1000` | |

## Accessibility

- The slider is a labelled carousel region with one tab stop. Arrow keys, Home and End move; Enter selects. Autoplay is off by default, pauses on hover and focus, and has a pause button.
- The lightbox is a dialog. Focus moves to the close button, Tab stays inside, and focus goes back on close. Left and Right move, Home and End jump to the first and last photo, + and - zoom, Escape closes. A key move puts a clear focus ring on the matching arrow button. Each photo's position and alt text are announced.
- Reduced motion follows the system, or set `reducedMotion` to `"always"` or `"never"`.

## Motion

- Open and close are critically damped springs: no bounce, about 250 ms to cover 95% of the way in and 220 ms out, so the exit is quicker than the entrance.
- Sideways swipes work like a photo strip: the photo follows the finger 1:1 and the previous and next photos peek in from the sides. On release frankaa projects where the fling would stop, picks the nearest photo and springs there carrying the finger's velocity. The first and last photos rubber-band (unless `loop`).
- The drag locks to one axis after 10 px, and only a clearly vertical drag (steeper than about 56 degrees) pulls down to close, so a slightly diagonal swipe never closes.
- Down closes, with the backdrop fading with the pull; up meets resistance. The photo can be caught again mid-animation.
- Keys and buttons change photos with the effect; swipes slide the strip, like a native photo viewer.
- Photo changes default to ease-out (no slow start on something the person triggered). In the CSS renderer they stay under 300 ms.
- Buttons press to scale .97. Hover and fades use `cubic-bezier(.23, 1, .32, 1)`.
- Reduced motion: no spring, no effect, a short fade; finger tracking stays, since the person is making that motion.

## Phones

- The page behind is pinned while the lightbox is open (iOS Safari ignores `overflow: hidden` for this), and comes back to the same scroll position on close.
- The overlay is `100dvh` and re-fits, with a spring, when the visual viewport changes as Safari's toolbars show or hide.
- The counter, close button, arrows and caption sit inside the safe areas. Use `viewport-fit=cover` in your viewport meta to let it use the full screen.
- On phones the previous and next buttons sit in the bottom corners, beside the caption, within thumb reach.
- A vertical swipe over a slider or a drumline scrolls the page; they only take sideways drags.
- `npm run check:touch` runs every part and combination with real touches on iPhone and Android profiles (Chromium) and on iPhone in WebKit, in portrait and landscape.

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
| `frankaa/slider` | 5.0 kB |
| `frankaa/lightbox` | 24.2 kB (the filmstrip loads only when used) |
| `frankaa/drumline` | 10.2 kB (the lightbox loads on the first tap) |
| `frankaa/loading` | 1.4 kB (the frost and liquid materials) |
| `frankaa` (all three) | 33.1 kB |
| `frankaa/react` (all three, with bindings) | 34.0 kB |
| `frankaa/style.css` | 4.7 kB |
| `frankaa/native` (all three for React Native) | 11.9 kB before your app's bundler minifies it; `frankaa/native/skia` 1.3 kB |

## Performance

- At rest, springing and swiping, each photo is drawn in one pass (a transform in CSS, one textured quad in WebGL); the effect shader runs only during a key or button change.
- Photos are decoded with `img.decode()` before they are shown or uploaded, and only the current photo and its neighbours are loaded, the neighbours when the browser is idle (at once after a filmstrip jump).
- The loading material runs only while a photo loads, drawn offscreen at no more than one texel per CSS pixel (1024 a side at most) and scaled into the box; the CSS film animates transform only.
- Layout is read when the lightbox opens or resizes, never inside an animation frame.
- `npm run check:perf` records frames during open, close, a swipe, every effect and the CSS renderer, on desktop and on an iPhone-sized viewport with the CPU slowed 4x. On an Apple silicon Mac it holds 60 fps on desktop, and the CSS renderer keeps every frame under 18 ms at 4x.

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
FRANKAA_RN_MODULES=../my-expo-app/node_modules npm run typecheck:native # frankaa/native against an app's React Native types
npm run check:keys # browser keyboard check; needs Playwright (see the script's header)
npm run check:touch # phone check: real touch swipes, peeking, rubber-band, axis lock, taps, scroll lock
npm run check:perf  # frame rate: fps, p95 frame time, dropped frames, long tasks
npm run check:features # actions and controls, videos, destroy() hooks, zoom, resets, slider options
npm run check:drumline # every preset and fluid mode, WebGL bend and its fallback, the filmstrip, React StrictMode
npm run check:loading  # slow, missing and failing photos in both renderers: the ring, the reveal, Retry, quick taps
```

The docs page is `docs/index.html`; serve the folder and open it.

## Releasing

Releases publish from GitHub Actions with npm trusted publishing (OIDC) and provenance, so no npm token is stored anywhere. The owner links the package to this repository once:

1. Publish the first version by hand, or create the package on npmjs.com, so the name `frankaa` exists under your account.
2. On npmjs.com, open the package, then Settings, then Trusted publishing, and add a GitHub Actions publisher: organisation or user `JABClari`, repository `frankaa`, workflow file `release.yml`, no environment.
3. In the same settings, set publishing access to require two-factor authentication and disallow tokens.
4. To release: bump `version` in package.json, commit, tag `vX.Y.Z`, push the tag, then publish a GitHub release for it. The workflow tests, builds and runs `npm publish`; npm attaches the provenance statement.

## Credits

Made by Sirius Arc, built by Joshua.

Photos on the docs page are CC0; sources are listed in `docs/photos/CREDITS.txt`.

## Licence

MIT. See [LICENSE](LICENSE).
