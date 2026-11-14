// unfurl: a photo lightbox. The photo lifts out of its spot and springs to full view, moves between photos with
// an effect, and springs back to its spot when closed. Two renderers: WebGL (a canvas, with shader effects) and
// CSS (transform and opacity only). "auto" uses WebGL where it is there. With reduced motion it is a plain fade.
// If WebGL cannot draw a photo (no WebGL, or a cross-origin photo without CORS headers) it switches to CSS and
// says so through onError, so nothing fails silently.
import { clampPan, isZoomed, lockAxis, neighbours, onScreen, pickRenderer, pickSlide, project, settleZoom, stageBox, swipeIntent, toR4, zoomAbout, STRIP_GAP, type Box, type Radius, type RendererPref, type Stage, type StageCtx } from "./lightbox-math";
import { checkEffect, createGlStage, supported } from "./lightbox-gl";
import { createCssStage } from "./lightbox-css";
import { getEffect, registerEffect, effectNames, type Effect, type EffectName, type CssTransition, type Easing, type UniformValue } from "./effects";
import { fill, lightboxKey, resolveReduced, rubber, velocity, type ReducedMotion } from "./shared";
import { CHEVRON, CHEVRON_LEFT, CROSS, PLAY, el, emitter, icon, systemReduces, type Icons } from "./dom";
import { embedUrl, type MediaProvider } from "./media";
import { videoPlayer, type VideoLabels, type VideoPlayer } from "./video";
import type { Drumline, DrumlineOptions } from "./drumline";
import { drumlineLook, stripOptions, type DrumlinePreset } from "./drumline-math";
import { readArgs, fullSrc, isVideo as isVideoItem, type ImageItem, type Item, type Items, type VideoItem } from "./items";

export { supported, checkEffect, registerEffect, effectNames };
export type { Effect, EffectName, CssTransition, Easing, UniformValue, RendererPref, ReducedMotion, MediaProvider };
export { embedUrl };

/** The shared item format (see items.ts): images and videos, the same list for every part. */
export type UnfurlPhoto = ImageItem;
export type UnfurlVideo = VideoItem;
export type UnfurlItem = Item;
/** What actions and controls get: the lightbox's state and a few of its controls. */
export type UnfurlApi = { readonly index: number; readonly item: UnfurlItem; close(): void; next(): void; prev(): void; show(i: number): void };
export type UnfurlAction = {
  /** The button's text, or its accessible name when it has an icon. */
  label: string;
  onClick: (api: UnfurlApi) => void;
  /** An icon: the d of a 24px stroked path. With an icon the button is round and shows only the icon. */
  icon?: string;
};
export type MoveHow = "key" | "button" | "swipe" | "strip" | "api";
export type AnimationType = "open" | "close" | "change";

export type UnfurlLabels = {
  /** The dialog's name. Default "Photos". */
  dialog: string;
  close: string;
  next: string;
  previous: string;
  /** Read out on each photo. {n}, {total}. Default "Photo {n} of {total}". The photo's alt follows it. */
  position: string;
  /** Read out on a video slide. Default "Video {n} of {total}". */
  videoPosition: string;
  /** The play button on a video slide. Default "Play video". */
  play: string;
  /** The visible counter. {n}, {total}. Default "{n} / {total}". */
  counter: string;
} & Omit<VideoLabels, "play">;
export const UNFURL_LABELS: UnfurlLabels = { dialog: "Photos", close: "Close", next: "Next photo", previous: "Previous photo", position: "Photo {n} of {total}", videoPosition: "Video {n} of {total}", play: "Play video", counter: "{n} / {total}", pause: "Pause video", mute: "Mute", unmute: "Unmute", seek: "Seek", volume: "Volume", fullscreen: "Full screen", exitFullscreen: "Exit full screen", timeOf: "{time} of {duration}" };

/** cors: a cross-origin photo without CORS headers; load: the photo did not load; webgl: no WebGL (only when
 *  renderer is "webgl"); shader: the effect did not compile (message has the log). */
export type UnfurlError = { index: number; src: string; reason: "cors" | "load" | "webgl" | "shader" | "media"; fallback: "css" | "none"; message?: string };
/** Why the lightbox closed: the person or close() ("close"), or destroy() ("destroy"). */
export type CloseReason = "close" | "destroy";

export type UnfurlHooks = {
  onOpenStart?: (d: { index: number }) => void;
  onOpenEnd?: (d: { index: number; renderer: "webgl" | "css" }) => void;
  /** Also fired by destroy() while open, with reason "destroy". */
  onCloseStart?: (d: { index: number; reason: CloseReason }) => void;
  onCloseEnd?: (d: { index: number; reason: CloseReason }) => void;
  onChange?: (index: number, d: { index: number; from: number; how: MoveHow }) => void;
  onAnimationStart?: (d: { type: AnimationType; index: number }) => void;
  /** cancelled is true when destroy() cut the animation short. */
  onAnimationEnd?: (d: { type: AnimationType; index: number; cancelled?: boolean }) => void;
  onError?: (d: UnfurlError) => void;
};

export type UnfurlOptions = UnfurlHooks & {
  /** The items, in order (the shared format: images and videos; strings are taken as src). The lightbox shows
   *  full (or src); same-origin or CORS-enabled for WebGL. Or pass them as the first argument. */
  items?: Items;
  /** The older name for items. */
  photos?: Items;
  /** Extra buttons in the top bar, before Close, inside the focus trap. */
  topActions?: UnfurlAction[];
  /** Your own controls: called once with a host element in the top bar (before Close, inside the focus trap).
   *  Return a function to tidy up; it runs when the lightbox leaves the page. */
  controls?: (host: HTMLElement, api: UnfurlApi) => void | (() => void);
  /** The photo to open on. Default 0. */
  start?: number;
  /** Where photo i sits on the page now: an element or a rect. Null (or off screen) means it fades instead. */
  origin?: (i: number) => Element | DOMRect | null;
  /** Shorthand for labels.dialog. */
  label?: string;
  /** Wrap from the last photo to the first (arrows, keys and swipes). Default false: the ends rubber-band. */
  loop?: boolean;
  /** Every string the lightbox shows or reads out, for other languages. */
  labels?: Partial<UnfurlLabels>;
  /** The effect between photos: a built-in or registered name, or your own { fragment, uniforms, duration, easing }.
   *  Default "displacement". The CSS renderer shows each as a fade, slide, zoom or cut. */
  effect?: EffectName | (string & {}) | Effect;
  /** "auto" (default) uses WebGL where it is there, else CSS. "css" never touches WebGL. */
  renderer?: RendererPref;
  /** What a sideways swipe does with WebGL: "effect" (default) runs the effect under the finger, its progress
   *  following the drag; "strip" slides the photos side by side. The CSS renderer always slides. */
  swipe?: "effect" | "strip";
  /** "system" (default) follows the person's setting; "always" and "never" override it. */
  reducedMotion?: ReducedMotion;
  /** Keep Tab inside the dialog. Default true. */
  focusTrap?: boolean;
  /** Where focus goes on close: true (default) back to where it was, an element, or false to leave it. */
  returnFocus?: boolean | HTMLElement;
  /** Read each photo out through a polite live region. Default true. */
  announce?: boolean;
  /** Hide the origin element while its photo is out, so it looks lifted. Default true. */
  hideOrigin?: boolean;
  /** Corner radius of the photo in its spot, in CSS px: one number, four ([top left, top right, bottom right,
   *  bottom left]), or a function of the photo's index for grids whose tiles differ. Default 16. */
  radius?: Radius | ((i: number) => Radius);
  /** Corner radius when open: one number or four. Default 12. */
  openRadius?: Radius;
  /** Pinch, double tap (or double click) and Ctrl or trackpad pinch to zoom; drag to pan when zoomed. Default
   *  true. { max } sets the largest zoom (default 4). */
  zoom?: boolean | { max?: number };
  /** Your own icons (next, prev, close, play), as the d of a 24px stroked path. */
  icons?: Icons;
  /** Where the dialog mounts, and where its events are dispatched. Default document.body. */
  container?: HTMLElement;
  /** A filmstrip under the photo for moving between them: true or "drumline" (the ruler preset), a preset name
   *  ("ruler", "numbers", "minimal"), or drumline options ({ preset, fluid, numbers, ... }). It shows each item's
   *  thumb (or src). Default none. */
  strip?: boolean | "drumline" | DrumlinePreset | Omit<DrumlineOptions, "items" | "photos" | "start" | "expand">;
};

export type Unfurl = {
  /** The photo showing now. */
  readonly index: number;
  /** The renderer in use: "webgl" or "css". */
  readonly renderer: "webgl" | "css";
  next(): void;
  prev(): void;
  /** Go to photo i. */
  show(i: number): void;
  /** Close, springing back to the spot. */
  close(): void;
  /** Remove at once, without animating. Fires onCloseStart and onCloseEnd with reason "destroy" if still open,
   *  unless hooks is false (the React hook passes false on unmount). */
  destroy(o?: { hooks?: boolean }): void;
};

type Phase = "opening" | "open" | "closing" | "closed";

/**
 * Open the lightbox: unfurl(items, options) or unfurl({ items, ...options }). It closes itself (Escape, the close
 * button, a tap, or a pull down).
 */
export function unfurl(items: Items, options?: Omit<UnfurlOptions, "items" | "photos">): Unfurl;
export function unfurl(options: UnfurlOptions): Unfurl;
export function unfurl(a: Items | UnfurlOptions, b?: Omit<UnfurlOptions, "items" | "photos">): Unfurl {
  const { items: photos, options } = readArgs<UnfurlOptions>(a, b);
  const isVideo = isVideoItem;
  const imageOf = fullSrc;
  // srcset describes src; with a separate full file the lightbox uses that alone.
  const sourceOf = (p: Item) => (isVideo(p) ? { src: fullSrc(p) } : p.full ? { src: p.full, placeholder: p.placeholder } : { src: p.src, srcset: p.srcset, sizes: p.sizes, placeholder: p.placeholder });
  const ic = options.icons ?? {};
  const n = photos.length;
  const L: UnfurlLabels = { ...UNFURL_LABELS, ...(options.label ? { dialog: options.label } : {}), ...options.labels };
  const still = resolveReduced(options.reducedMotion, systemReduces());
  const effect = getEffect(still ? "fade" : options.effect);
  const trap = options.focusTrap !== false;
  const announce = options.announce !== false;
  const hideOrigin = options.hideOrigin !== false;
  const container = options.container ?? document.body;
  const before = document.activeElement as HTMLElement | null;
  const emit = emitter(options, () => container);
  // Every animation start gets exactly one end, even when destroy() cuts it short.
  const pending: AnimationType[] = [];
  const animStart = (type: AnimationType, i: number) => { pending.push(type); emit("onAnimationStart", { type, index: i }); };
  const animEnd = (type: AnimationType, i: number, cancelled = false) => {
    const k = pending.indexOf(type);
    if (k < 0) return;
    pending.splice(k, 1);
    emit("onAnimationEnd", cancelled ? { type, index: i, cancelled } : { type, index: i });
  };
  let index = Math.min(n - 1, Math.max(0, options.start ?? 0));
  let phase = "opening" as Phase;

  // The dialog and its controls. Text goes in with textContent only.
  const root = el("div", "fk-unfurl", { role: "dialog", "aria-label": L.dialog, "data-phase": "opening" });
  if (trap) root.setAttribute("aria-modal", "true");
  if (still) root.dataset.motion = "reduced";
  const bg = el("div", "fk-unfurl-bg", { "aria-hidden": "true" });
  const canvas = el("canvas", "fk-unfurl-gl", { "aria-hidden": "true" });
  const cssHost = el("div", "fk-unfurl-css");
  const top = el("div", "fk-unfurl-top");
  const count = el("span", "fk-unfurl-n", { "aria-hidden": "true" });
  const status = el("span", "fk-sr", announce ? { "aria-live": "polite", "aria-atomic": "true" } : {});
  const closeBtn = el("button", "fk-unfurl-btn fk-unfurl-close", { type: "button", "aria-label": L.close });
  closeBtn.append(icon(ic.close ?? CROSS, 18));
  const actions = el("div", "fk-unfurl-actions");
  top.append(count, status, actions, closeBtn);
  const media = el("div", "fk-unfurl-media");
  media.hidden = true;
  const prevBtn = el("button", "fk-unfurl-btn fk-unfurl-prev", { type: "button", "aria-label": L.previous });
  const nextBtn = el("button", "fk-unfurl-btn fk-unfurl-next", { type: "button", "aria-label": L.next });
  prevBtn.append(icon(ic.prev ?? CHEVRON_LEFT, 18));
  nextBtn.append(icon(ic.next ?? CHEVRON, 18));
  const cap = el("p", "fk-unfurl-cap");
  root.append(bg, canvas, cssHost, media, top);
  if (n > 1) root.append(prevBtn, nextBtn);
  root.append(cap);
  // The filmstrip (drumline), when asked for: it sits along the bottom; the photo makes room for it.
  const stripOpts = stripOptions(options.strip) as Omit<DrumlineOptions, "items" | "photos"> | null;
  const stripHost = stripOpts ? el("div", "fk-unfurl-strip") : null;
  if (stripHost) {
    root.append(stripHost); root.dataset.strip = "true";
    // The band is as tall as the look needs: pictures alone are short; a ruler or numbers need the full band.
    const look = drumlineLook(stripOpts!);
    root.dataset.stripSize = !look.ticks && !look.numbers ? "short" : "full";
  }
  let filmstrip: Drumline | null = null;
  let stripTimer = 0;

  const loop = !!options.loop;
  const label = () => {
    const p = photos[index], v = { n: index + 1, total: n };
    // At the ends (without loop) the arrow there is marked unavailable but keeps focus, so the focus trap holds.
    const nb = neighbours(index, n, loop);
    prevBtn.setAttribute("aria-disabled", String(nb.prev === null));
    nextBtn.setAttribute("aria-disabled", String(nb.next === null));
    count.textContent = fill(L.counter, v);
    if (announce) status.textContent = fill(isVideo(p) ? L.videoPosition : L.position, v) + (p.alt ? `. ${p.alt}` : "");
    cap.textContent = p.caption ?? "";
    cap.hidden = !p.caption;
  };
  label();

  const spot = (i: number): { box: Box | null; el: HTMLElement | null } => {
    const o = options.origin?.(i) ?? null;
    if (!o) return { box: null, el: null };
    const isEl = o instanceof Element;
    const r = isEl ? o.getBoundingClientRect() : o;
    const box = onScreen(r, window.innerWidth, window.innerHeight) ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
    return { box, el: isEl ? (o as HTMLElement) : null };
  };
  let hidden: HTMLElement | null = null;
  const hide = (i: number | null) => {
    if (hidden) hidden.style.visibility = "";
    hidden = null;
    if (i === null || !hideOrigin) return;
    const e = spot(i).el;
    if (e) { e.style.visibility = "hidden"; hidden = e; }
  };

  // Lock the page. overflow: hidden alone does not stop iOS Safari scrolling the page under a fixed overlay (and
  // when Safari starts that pan it cancels our pointer, which kills swipes), so the body is pinned in place at its
  // scroll position and given back on close. Padding stands in for the scrollbar so nothing shifts sideways.
  const html = document.documentElement, body = document.body;
  const lock = { x: window.scrollX, y: window.scrollY, html: html.getAttribute("style"), body: body.getAttribute("style") };
  const gap = window.innerWidth - html.clientWidth;
  html.style.overflow = "hidden";
  Object.assign(body.style, { position: "fixed", top: `${-lock.y}px`, left: `${-lock.x}px`, right: "0", width: "100%", overflow: "hidden" });
  if (gap > 0) body.style.paddingRight = `${gap}px`;
  const unlock = () => {
    if (lock.html === null) html.removeAttribute("style"); else html.setAttribute("style", lock.html);
    if (lock.body === null) body.removeAttribute("style"); else body.setAttribute("style", lock.body);
    const behavior = html.style.scrollBehavior;
    html.style.scrollBehavior = "auto";
    window.scrollTo(lock.x, lock.y);
    html.style.scrollBehavior = behavior;
  };

  const setPhase = (p: Phase) => { phase = p; root.dataset.phase = p; };

  // ---------- Renderers ----------
  const ctx: StageCtx = {
    still,
    rSpot: (i: number) => toR4(typeof options.radius === "function" ? options.radius(i) : options.radius, 16),
    rOpen: toR4(options.openRadius, 12), duration: effect.duration ?? 480, count: n, loop, swipeFx: options.swipe !== "strip",
    // The room the photo may use: the overlay's own box (100dvh, so it follows Safari's toolbars) less the safe
    // areas, which the overlay carries as padding.
    area: () => {
      const r = root.getBoundingClientRect(), cs = getComputedStyle(root);
      const px = (v: string) => parseFloat(v) || 0;
      const pt = px(cs.paddingTop), pr = px(cs.paddingRight), pb = px(cs.paddingBottom), pl = px(cs.paddingLeft);
      const w = r.width || window.innerWidth, h = r.height || window.visualViewport?.height || window.innerHeight;
      const sh = stripHost ? stripHost.offsetHeight : 0;
      if (stripHost) root.style.setProperty("--fk-strip-h", `${sh}px`);
      const b = stageBox(w - pl - pr, h - pt - pb - sh, !!stripHost);
      return { x: b.x + pl, y: b.y + pt, w: b.w, h: b.h };
    },
  };
  const wantGl = pickRenderer(options.renderer, true) === "webgl";
  let stage: Stage | null = null;
  if (wantGl) {
    const built = createGlStage(canvas, photos.map(sourceOf), effect, ctx);
    if (built.stage) stage = built.stage;
    // A shader that does not compile is always reported; missing WebGL only when WebGL was asked for by name.
    else if (built.error.reason === "shader" || options.renderer === "webgl") {
      const err = built.error;
      queueMicrotask(() => emit("onError", { index, src: imageOf(photos[index]), reason: err.reason, fallback: "css", message: err.message } satisfies UnfurlError));
    }
  }
  const useCss = () => {
    stage?.destroy();
    stage = createCssStage(cssHost, photos.map(sourceOf), effect.css ?? "fade", ctx);
    root.dataset.renderer = "css";
    return stage;
  };
  if (!stage) useCss(); else root.dataset.renderer = "webgl";

  // WebGL could not draw photo i: tell the caller, switch to CSS, and show it there without the spring.
  const fallBack = async (i: number) => {
    const s = useCss();
    const ok = await s.open(i, null, () => hide(i));
    emit("onError", { index: i, src: imageOf(photos[i]), reason: ok ? "cors" : "load", fallback: ok ? "css" : "none" } satisfies UnfurlError);
    return ok;
  };

  // ---------- Video slides: a play button over the poster, the player only after a tap ----------
  let mediaFor = -1;
  // The mp4 player while one is open (frankaa's own controls; other providers bring their own).
  let player: VideoPlayer | null = null;
  const hideMedia = () => {
    if (mediaFor === -1 && media.hidden) return;
    mediaFor = -1;
    player?.destroy();
    player = null;
    // Removing the player stops it.
    media.replaceChildren();
    media.hidden = true;
  };
  const placeMedia = () => {
    const r = stage?.rect();
    if (!r) return false;
    Object.assign(media.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, borderRadius: ctx.rOpen.map((x) => `${x}px`).join(" ") });
    return true;
  };
  const showMedia = () => {
    const p = photos[index];
    if (!isVideo(p) || mediaFor === index || phase !== "open") return;
    if (!placeMedia()) return;
    mediaFor = index;
    media.replaceChildren();
    media.hidden = false;
    const play = el("button", "fk-unfurl-play", { type: "button", "aria-label": p.title ? `${L.play}: ${p.title}` : L.play });
    play.append(icon(ic.play ?? PLAY, 26));
    play.addEventListener("click", () => playMedia(p));
    // An mp4 without a poster shows its own first frame behind the play button (the neutral still is under it).
    const firstFrame = !p.poster && p.provider === "mp4" ? embedUrl("mp4", p.src) : null;
    if (firstFrame) media.append(el("video", "fk-unfurl-still", { src: `${firstFrame}#t=0.1`, muted: "", playsinline: "", preload: "metadata", "aria-hidden": "true" }));
    media.append(play);
  };
  const playMedia = (p: UnfurlVideo) => {
    const url = embedUrl(p.provider, p.src);
    if (!url) {
      emit("onError", { index, src: p.src, reason: "media", fallback: "none", message: `not a usable ${p.provider} source` } satisfies UnfurlError);
      return;
    }
    let node: HTMLElement;
    if (p.provider === "mp4") {
      const at = index;
      let failed = false;
      player?.destroy();
      player = videoPlayer(url, {
        poster: p.poster,
        title: p.title || p.alt || L.play,
        labels: L,
        reduced: () => still,
        onError: () => {
          if (failed) return;
          failed = true;
          emit("onError", { index: at, src: p.src, reason: "media", fallback: "none", message: "the video did not load" } satisfies UnfurlError);
        },
      });
      node = player.el;
    } else {
      // Sandboxed, no referrer path, and only the abilities a player needs.
      node = el("iframe", "fk-unfurl-player", {
        src: url,
        title: p.title || p.alt || L.play,
        allow: "autoplay; encrypted-media; picture-in-picture; fullscreen",
        allowfullscreen: "",
        referrerpolicy: "strict-origin-when-cross-origin",
        sandbox: "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox",
      });
    }
    media.replaceChildren(node);
    node.focus({ preventScroll: true });
  };

  // ---------- Your controls: actions and a host for anything else, before Close ----------
  const api: UnfurlApi = {
    get index() { return index; },
    get item() { return photos[index]; },
    close: () => close(),
    next: () => move(1, "api"),
    prev: () => move(-1, "api"),
    show: (i: number) => show(i, "api"),
  };
  for (const a of options.topActions ?? []) {
    const b = el("button", a.icon ? "fk-unfurl-btn fk-unfurl-act" : "fk-unfurl-action", { type: "button" });
    if (a.icon) { b.setAttribute("aria-label", a.label); b.append(icon(a.icon, 18)); } else b.textContent = a.label;
    b.addEventListener("click", () => a.onClick(api));
    actions.append(b);
  }
  let cleanupControls: (() => void) | void;
  if (options.controls) {
    const host = el("div", "fk-unfurl-controls");
    actions.append(host);
    cleanupControls = options.controls(host, api);
  }

  // ---------- Open ----------
  container.append(root);
  // The filmstrip loads only when asked for; its box is sized by CSS, so the photo makes room from the start.
  if (stripHost && stripOpts) {
    void import("./drumline").then(({ drumline }) => {
      if (phase === "closed") return;
      filmstrip = drumline(stripHost, photos, {
        label: L.dialog, ...stripOpts, start: index, expand: false,
        onChange: (i, d) => {
          stripOpts.onChange?.(i, d);
          if (d.how === "api") return;
          // While the strip is being scrubbed, the photo follows once it pauses (decoding a large photo for every
          // picture passed would stall a phone); a tap or a key moves it at once.
          clearTimeout(stripTimer);
          if (d.how === "tap" || d.how === "key") show(i, "strip");
          else stripTimer = window.setTimeout(() => show(i, "strip"), 110);
        },
      });
    });
  }
  closeBtn.focus({ preventScroll: true });
  emit("onOpenStart", { index });
  animStart("open", index);
  void (async () => {
    const from = spot(index).box;
    const s = stage!;
    let ok = await s.open(index, from, () => hide(index));
    if (phase === "closed") return;
    if (!ok && s.kind === "webgl") ok = await fallBack(index);
    else if (!ok) emit("onError", { index, src: imageOf(photos[index]), reason: "load", fallback: "none" } satisfies UnfurlError);
    if (phase !== "opening") { animEnd("open", index); return; }
    setPhase("open");
    animEnd("open", index);
    emit("onOpenEnd", { index, renderer: stage!.kind });
    showMedia();
  })();

  // Re-fit when the window or the visual viewport changes (Safari's toolbars, rotation); the photo springs there.
  let fitFrame = 0;
  const onResize = () => { cancelAnimationFrame(fitFrame); fitFrame = requestAnimationFrame(() => { stage?.resize(); if (!media.hidden) placeMedia(); }); };
  window.addEventListener("resize", onResize);
  window.visualViewport?.addEventListener("resize", onResize);

  // ---------- Moving ----------
  const show = (to: number, how: MoveHow, dir?: 1 | -1) => {
    if (phase === "closing" || phase === "closed" || n < 2) return;
    if (!loop && (to < 0 || to >= n)) return;
    const next = ((to % n) + n) % n;
    if (next === index) return;
    const from = index, d = dir ?? (next > from ? 1 : -1);
    const plain = isVideo(photos[from]) || isVideo(photos[next]);
    hideMedia();
    root.dataset.zoomed = "false";
    if (how !== "strip") filmstrip?.go(next);
    index = next;
    label();
    hide(next);
    emit("onChange", { index: next, from, how }, next, { index: next, from, how });
    animStart("change", next);
    const s = stage!;
    void s.show(next, d, plain).then(async (ok) => {
      if (!ok && phase !== "closed" && s.kind === "webgl" && stage === s) await fallBack(next);
      else if (!ok && phase !== "closed") emit("onError", { index: next, src: imageOf(photos[next]), reason: "load", fallback: "none" } satisfies UnfurlError);
      animEnd("change", next);
      if (phase === "open" && index === next) showMedia();
    });
  };
  const move = (d: 1 | -1, how: MoveHow) => show(index + d, how, d);

  // ---------- Closing ----------
  const close = () => {
    if (phase === "closing" || phase === "closed") return;
    setPhase("closing");
    hideMedia();
    emit("onCloseStart", { index, reason: "close" });
    animStart("close", index);
    void stage!.close(spot(index).box).then(() => {
      if (phase === "closed") return;
      teardown();
      animEnd("close", index);
      emit("onCloseEnd", { index, reason: "close" });
    });
  };

  const teardown = () => {
    setPhase("closed");
    cancelTap();
    hideMedia();
    try { cleanupControls?.(); } catch (e) { setTimeout(() => { throw e; }); }
    window.removeEventListener("resize", onResize);
    window.visualViewport?.removeEventListener("resize", onResize);
    cancelAnimationFrame(fitFrame);
    window.removeEventListener("keydown", onKey, true);
    stage?.destroy(); stage = null;
    filmstrip?.destroy(); filmstrip = null;
    clearTimeout(stripTimer);
    hide(null);
    root.remove();
    unlock();
    const back = options.returnFocus === false ? null : options.returnFocus instanceof HTMLElement ? options.returnFocus : before;
    if (back && document.contains(back)) back.focus({ preventScroll: true });
  };

  // Keys: arrows move, Home and End jump, Escape closes, Tab stays inside (unless focusTrap is false). A key move
  // puts focus on the matching arrow button, so the person sees a clear focus ring on what they just did.
  const ring = (b: HTMLElement) => { if (b.offsetParent !== null && root.contains(document.activeElement)) b.focus({ preventScroll: true }); };
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    // With focus in the mp4 player, its keys win (Space, K, arrows seek, J, L, M, F); Escape and Tab still go to the
    // lightbox, and the seek and volume sliders keep their own arrows.
    if (player && e.key !== "Escape" && e.key !== "Tab" && player.el.contains(e.target as Node)) {
      if (player.key(e)) { e.preventDefault(); return; }
      if ((e.target as Element).classList?.contains("fk-vc-range")) return;
    }
    const act = lightboxKey(e.key);
    if (act) {
      e.preventDefault();
      if (act === "close") close();
      else if (act === "next") { move(1, "key"); ring(nextBtn); }
      else if (act === "prev") { move(-1, "key"); ring(prevBtn); }
      else if (act === "first") show(0, "key", -1);
      else show(n - 1, "key", 1);
    } else if ((e.key === "+" || e.key === "=" || e.key === "-") && canZoom()) {
      // + and - zoom about the middle of the photo.
      e.preventDefault();
      const r = stage?.current();
      if (r) zoomAt(r.x + r.w / 2, r.y + r.h / 2, e.key === "-" ? 1 / 1.5 : 1.5);
    } else if (e.key === "Tab" && trap) {
      const f = Array.from(root.querySelectorAll<HTMLElement>("button, a[href], input, iframe, video[controls], [tabindex]:not([tabindex='-1'])")).filter((b) => !b.hidden && b.offsetParent !== null);
      e.preventDefault();
      if (!f.length) return;
      const i = f.indexOf(document.activeElement as HTMLElement);
      f[e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i === -1 || i === f.length - 1 ? 0 : i + 1)].focus();
    }
  };
  window.addEventListener("keydown", onKey, true);

  closeBtn.addEventListener("click", close);
  prevBtn.addEventListener("click", () => move(-1, "button"));
  nextBtn.addEventListener("click", () => move(1, "button"));

  // Gestures. While the finger is down the photo follows it 1:1 (sideways to change photo, down to close, up with
  // resistance); the backdrop fades with the pull. On release the spring takes over with the finger's velocity:
  // it moves, closes or settles back. The photo can be caught at any point, even mid-animation.
  // Zoom: two fingers pinch toward their midpoint; a double tap (or double click) zooms in at the point or back
  // out; Ctrl or trackpad pinch on the wheel zooms at the pointer. While zoomed one finger pans, with momentum,
  // and the photo always covers the view.
  const zoomOn = options.zoom !== false;
  const zoomMax = typeof options.zoom === "object" && options.zoom.max ? Math.max(1.5, options.zoom.max) : 4;
  const canZoom = () => zoomOn && !isVideo(photos[index]) && phase === "open";
  const view = (): Box => ({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
  const zoomedNow = () => isZoomed(stage?.current() ?? null, stage?.rect() ?? null);
  const zoomTo = (box: Box, v = { vx: 0, vy: 0 }) => {
    const s = stage, rest = s?.rect();
    if (!s || !rest) return;
    const target = settleZoom(box, rest, zoomMax, view());
    root.dataset.zoomed = String(isZoomed(target, rest));
    void s.glide(target, v);
  };
  const zoomAt = (x: number, y: number, factor: number) => {
    const cur = stage?.current(), rest = stage?.rect();
    if (!cur || !rest) return;
    const s = Math.min(zoomMax, Math.max(1, (cur.w * factor) / rest.w)) / (cur.w / rest.w);
    zoomTo(zoomAbout(cur, s, { x, y }, { x, y }));
  };
  const toggleZoom = (x: number, y: number) => {
    const rest = stage?.rect();
    if (!rest) return;
    if (zoomedNow()) zoomTo(rest);
    else zoomTo(zoomAbout(rest, Math.min(2.5, zoomMax), { x, y }, { x, y }));
  };

  type Drag = { id: number; x: number; y: number; px: number; axis: "x" | "y" | "pan" | null; box0: Box | null; samples: { x: number; y: number; t: number }[] };
  let drag: Drag | null = null;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { d0: number; m0: { x: number; y: number }; box0: Box } | null = null;
  let afterPinch = false;
  const pull = (dy: number) => Math.min(1, Math.max(0, dy) / (window.innerHeight * 0.5));
  // The strip's width is read once per drag, at the first move, never per frame.
  let stripW = 0;
  const stripWidth = () => stripW || (stripW = ctx.area().w);
  // A sideways swipe ends: the strip settles on the chosen photo (dir 1 next, -1 previous, 0 the same one).
  const slide = (dir: -1 | 0 | 1, vx: number) => {
    stripW = 0;
    const s = stage!;
    if (dir === 0) { void s.settle(0, vx).then(() => { if (phase === "open") showMedia(); }); return; }
    const from = index, next = neighbours(index, n, loop)[dir > 0 ? "next" : "prev"]!;
    hideMedia();
    index = next;
    label();
    hide(next);
    root.dataset.zoomed = "false";
    emit("onChange", { index: next, from, how: "swipe" }, next, { index: next, from, how: "swipe" });
    filmstrip?.go(next);
    animStart("change", next);
    void s.settle(dir, vx).then(() => { animEnd("change", next); if (phase === "open" && index === next) showMedia(); });
  };
  // Abandon a one-finger drag (a second finger arrived): put things back as they were.
  const dropDrag = () => {
    const d = drag;
    drag = null;
    if (!d) return;
    bg.style.transition = ""; bg.style.opacity = "";
    delete root.dataset.swiping;
    if (d.axis === "x") stage?.settle(0, 0);
    else if (d.axis === "y") stage?.release({ vx: 0, vy: 0 });
  };
  root.addEventListener("pointerdown", (e) => {
    if ((e.target as Element).closest("button, a, input, .fk-drumline, .fk-vc-bar") || phase === "closing" || phase === "closed") return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { root.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    if (pointers.size === 2 && canZoom()) {
      const cur = stage?.current();
      dropDrag();
      if (!cur) return;
      const [a, b] = [...pointers.values()];
      pinch = { d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, box0: cur };
      cancelTap();
      return;
    }
    if (drag || pinch || pointers.size > 1) return;
    const pan = canZoom() && zoomedNow();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, px: 0, axis: pan ? "pan" : null, box0: pan ? stage!.current() : null, samples: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }] };
  });
  root.addEventListener("pointermove", (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2 && stage) {
      const [a, b] = [...pointers.values()];
      const rest = stage.rect();
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      let s = Math.hypot(a.x - b.x, a.y - b.y) / pinch.d0;
      // Past the limits the pinch resists.
      if (rest) {
        const z = (pinch.box0.w * s) / rest.w;
        if (z < 1) s = (rest.w * (1 - rubber(1 - z, 0.5))) / pinch.box0.w;
        else if (z > zoomMax) s = (rest.w * (zoomMax + rubber(z - zoomMax, 1))) / pinch.box0.w;
      }
      hideMedia();
      stage.place(zoomAbout(pinch.box0, s, pinch.m0, m));
      return;
    }
    const d = drag;
    if (!d || e.pointerId !== d.id || !stage) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.samples.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    if (d.samples.length > 8) d.samples.shift();
    if (d.axis === "pan" && d.box0) {
      // Pan a zoomed photo 1:1; past its edges it resists.
      const want = { ...d.box0, x: d.box0.x + dx, y: d.box0.y + dy };
      const rest = stage.rect()!;
      const ok = clampPan(want, rest, view());
      const over = (a: number, b: number) => b + Math.sign(a - b) * rubber(Math.abs(a - b), 80);
      stage.place({ ...want, x: over(want.x, ok.x), y: over(want.y, ok.y) });
      if (Math.hypot(dx, dy) > 6) cancelTap();
      return;
    }
    if (!d.axis) {
      d.axis = lockAxis(dx, dy);
      if (!d.axis) return;
      cancelTap();
    }
    if (d.axis === "x") {
      // The strip follows the finger 1:1; past the first or last photo it resists.
      const nb = neighbours(index, n, loop);
      const open = dx < 0 ? nb.next !== null : nb.prev !== null;
      d.px = open ? dx : Math.sign(dx) * rubber(Math.abs(dx), stripWidth() * 0.25);
      root.dataset.swiping = "true";
      hideMedia();
      const toward = dx < 0 ? nb.next : nb.prev;
      stage.pan(d.px, isVideo(photos[index]) || (toward !== null && isVideo(photos[toward])));
    } else {
      const p = pull(dy);
      hideMedia();
      stage.track({ x: dx * 0.5, y: dy > 0 ? dy : -rubber(-dy, 60), s: 1 - 0.15 * p });
      bg.style.transition = "none";
      bg.style.opacity = String(1 - p * 0.75);
    }
  });

  // Taps: with zoom on, a single tap waits a moment for a second; two make a double tap.
  let tap: { t: number; x: number; y: number; timer: number } | null = null;
  const cancelTap = () => { if (tap) { clearTimeout(tap.timer); tap = null; } };
  const onTap = (x: number, y: number, t: number) => {
    // A tap on a playing (or paused) mp4 plays or pauses it instead of closing.
    if (player) {
      const r = player.el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) { player.toggle(); return; }
    }
    if (!canZoom()) { close(); return; }
    if (tap && t - tap.t < 300 && Math.hypot(x - tap.x, y - tap.y) < 40) { cancelTap(); toggleZoom(x, y); return; }
    cancelTap();
    tap = { t, x, y, timer: window.setTimeout(() => { tap = null; if (!zoomedNow()) close(); }, 300) };
  };

  const end = (e: PointerEvent, cancelled: boolean) => {
    pointers.delete(e.pointerId);
    if (pinch) {
      if (pointers.size < 2) {
        pinch = null;
        afterPinch = true;
        const cur = stage?.current();
        if (cur) zoomTo(cur);
      }
      return;
    }
    if (afterPinch) { if (!pointers.size) afterPinch = false; return; }
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    drag = null;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    // Velocity from the moves only: the lift often repeats the last position a little later, which would read as
    // slowing down. A finger that rested over 100 ms before lifting has no velocity.
    const lastMove = d.samples[d.samples.length - 1];
    const v = e.timeStamp - lastMove.t > 100 ? { vx: 0, vy: 0 } : velocity(d.samples);
    bg.style.transition = "";
    bg.style.opacity = "";
    delete root.dataset.swiping;
    if (d.axis === "pan") {
      if (Math.hypot(dx, dy) < 6 && !cancelled) { onTap(e.clientX, e.clientY, e.timeStamp); return; }
      // Momentum: project where the pan would coast to, keep it covering the view, and spring there.
      const cur = stage?.current();
      if (cur) zoomTo({ ...cur, x: cur.x + project(v.vx) * 0.35, y: cur.y + project(v.vy) * 0.35 }, v);
      return;
    }
    if (d.axis === "x") {
      // Project where the fling would stop, take the nearest photo, and spring there with the finger's velocity.
      const nb = neighbours(index, n, loop);
      const dir = cancelled ? 0 : pickSlide(d.px, v.vx, stripWidth() + STRIP_GAP, nb.prev !== null, nb.next !== null);
      slide(dir, v.vx);
      return;
    }
    const intent = cancelled ? null : d.axis === "y" ? swipeIntent(0, dy, 0, v.vy) : swipeIntent(dx, dy, v.vx, v.vy);
    if (d.axis) stage?.release(v);
    if (intent === "close") close();
    else if (intent === "tap" && !d.axis) onTap(e.clientX, e.clientY, e.timeStamp);
  };
  // Ctrl + wheel (and trackpad pinch, which browsers send as Ctrl + wheel) zooms at the pointer.
  root.addEventListener("wheel", (e) => {
    if (!e.ctrlKey || !canZoom()) return;
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
  }, { passive: false });
  // iOS and Android: never let a touch on the overlay become a browser pan or zoom. A pan would scroll the page
  // behind and fire pointercancel, which is what made sideways swipes fail. Taps and pointer events still work.
  const noPan = (e: TouchEvent) => { if (e.cancelable) e.preventDefault(); };
  root.addEventListener("touchmove", noPan, { passive: false });
  root.addEventListener("pointerup", (e) => end(e, false));
  root.addEventListener("pointercancel", (e) => end(e, true));

  return {
    get index() { return index; },
    get renderer() { return stage?.kind ?? "css"; },
    next: () => move(1, "api"),
    prev: () => move(-1, "api"),
    show: (i: number) => show(i, "api"),
    close,
    destroy: (o?: { hooks?: boolean }) => {
      if (phase === "closed") return;
      const hooks = o?.hooks !== false;
      // Tidy-up hooks still fire, so apps can reset their state (unless asked not to).
      if (hooks && phase !== "closing") emit("onCloseStart", { index, reason: "destroy" });
      if (hooks) for (const t of [...pending].reverse()) animEnd(t, index, true);
      teardown();
      if (hooks) emit("onCloseEnd", { index, reason: "destroy" });
    },
  };
}
