// procession: a photo slider on a native scroll-snap track. A swipe follows the finger 1:1 and keeps its
// momentum because the browser does the scrolling; we only read where it landed. Dots follow the scroll, arrows
// show on hover with a mouse and step one photo, and photos past the first load only once the slider comes near
// the screen (or is touched). Optional: loop, autoplay (off by default, with a pause button), proximity snap.
import { clampIndex, indexAt } from "./slider-math";
import { fill, nextIndex, resolveReduced, sliderKey, type ReducedMotion } from "./shared";
import { CHEVRON, CHEVRON_LEFT, PAUSE, PLAY, el, emitter, icon, placeholderStyle, systemReduces, type Icons } from "./dom";

export type Photo = {
  src: string;
  srcset?: string;
  sizes?: string;
  alt?: string;
  width?: number;
  height?: number;
  /** Shown until the photo paints: a colour ("#d9cbb5") or an image address (a tiny thumbnail, or a blurhash you
   *  decoded to a data URL). */
  placeholder?: string;
};

export type ProcessionLabels = {
  /** The slider's name. Default "Photos". */
  region: string;
  /** Added to the track's name for keyboard users. Default "use the arrow keys to move". */
  hint: string;
  next: string;
  previous: string;
  pause: string;
  play: string;
  /** Read out on each change. {n}, {total}. Default "Photo {n} of {total}". */
  position: string;
  /** The visible counter (option counter). {n}, {total}. Default "{n} / {total}". */
  counter: string;
};
export const PROCESSION_LABELS: ProcessionLabels = { region: "Photos", hint: "use the arrow keys to move", next: "Next photo", previous: "Previous photo", pause: "Pause slideshow", play: "Play slideshow", position: "Photo {n} of {total}", counter: "{n} / {total}" };

export type SlideHow = "scroll" | "key" | "button" | "autoplay" | "api";
export type ProcessionHooks = {
  /** The photo showing changed (after a swipe, key, arrow, autoplay or go()). */
  onSlideChange?: (index: number, d: { index: number; from: number }) => void;
  /** Same as onSlideChange, named to match the lightbox. */
  onChange?: (index: number, d: { index: number; from: number }) => void;
  /** The track started and stopped moving. type is "slide". */
  onAnimationStart?: (d: { type: "slide"; index: number }) => void;
  onAnimationEnd?: (d: { type: "slide"; index: number }) => void;
  /** A photo failed to load. */
  onError?: (d: { index: number; src: string; reason: "load" }) => void;
  /** Click, tap or Enter on the photo showing (for example to open the lightbox). The event is passed so you can
   *  leave Cmd, Ctrl, Shift and middle clicks to the browser (with href) or call preventDefault. */
  onSelect?: (index: number, img: HTMLImageElement, event: MouseEvent | KeyboardEvent | PointerEvent) => void;
};

export type ProcessionOptions = ProcessionHooks & {
  /** The photos, in order. Strings are taken as `src`. */
  photos: (Photo | string)[];
  /** Shorthand for labels.region. */
  label?: string;
  /** Every string the slider shows or reads out, for other languages. */
  labels?: Partial<ProcessionLabels>;
  /** The photo to start on. Default 0. */
  start?: number;
  /** Show the dots. Default true. */
  dots?: boolean;
  /** Show the arrows on hover (mouse) and keyboard focus. Default true. */
  arrows?: boolean;
  /** "mandatory" (default) always rests on a photo; "proximity" lets a slow drag rest between. */
  snap?: "mandatory" | "proximity";
  /** Arrows, keys and autoplay wrap from the last photo to the first (it rewinds). Default false. */
  loop?: boolean;
  /** Move on every so many ms. Off by default. Pauses on hover, focus, touch, a hidden tab, off screen, and reduced motion. */
  autoplay?: number | false;
  /** The first photo is above the fold: load it at once, first in line. Default false. */
  priority?: boolean;
  /** How near the screen before the other photos load. Default "100px". */
  lazyMargin?: string;
  /** "system" (default), "always" or "never". Reduced motion: steps jump, no autoplay. */
  reducedMotion?: ReducedMotion;
  /** Announce each change through a polite live region. Default true. */
  announce?: boolean;
  /** Make the slider a link: the track becomes an <a href>, so Cmd, Ctrl and middle click open it as usual. */
  href?: string;
  /** Put the slider in the tab order (arrow keys move it). Default true; false when another link or button on
   *  the card already takes focus. */
  tabbable?: boolean;
  /** Show a "2 / 5" counter. Default false. */
  counter?: boolean;
  /** Pinch to zoom toward the fingers (springs back on release), and double tap to zoom in and out. Default false. */
  zoom?: boolean;
  /** Show the zoom-in cursor, for a slider that opens a lightbox. Default false. */
  zoomCursor?: boolean;
  /** "outside" (default) draws the focus ring around the slider; "inset" draws it inside, for sliders in a parent
   *  with overflow: hidden. */
  focusRing?: "outside" | "inset";
  /** Your own arrow and play or pause icons, as the d of a 24px stroked path. */
  icons?: Icons;
};

export type Procession = {
  /** The photo showing now. */
  readonly index: number;
  /** The slider's root element. */
  readonly el: HTMLElement;
  /** Go to photo i. Smooth unless reduced motion is on or `smooth` is false. */
  go(i: number, smooth?: boolean): void;
  next(): void;
  prev(): void;
  /** Start or stop autoplay (only when the autoplay option is set). */
  play(): void;
  pause(): void;
  /** The image element for photo i. */
  image(i: number): HTMLImageElement | undefined;
  /** Remove what the slider added and stop listening. */
  destroy(): void;
};

const toPhoto = (p: Photo | string): Photo => (typeof p === "string" ? { src: p } : p);

/** Turn an element into a photo slider. The element's own children are left alone; the slider adds its own. */
export function procession(root: HTMLElement, options: ProcessionOptions): Procession {
  const photos = options.photos.map(toPhoto);
  const n = photos.length;
  const L: ProcessionLabels = { ...PROCESSION_LABELS, ...(options.label ? { region: options.label } : {}), ...options.labels };
  const loop = !!options.loop;
  const announce = options.announce !== false;
  const reduced = () => resolveReduced(options.reducedMotion, systemReduces());
  const emit = emitter(options, () => root);
  let at = clampIndex(options.start ?? 0, n);

  root.classList.add("fk-procession");
  root.setAttribute("role", "region");
  root.setAttribute("aria-roledescription", "carousel");
  root.setAttribute("aria-label", L.region);
  if (reduced()) root.dataset.motion = "reduced";
  if (options.focusRing === "inset") root.classList.add("fk-ring-inset");
  if (options.zoom) root.classList.add("fk-zoomable");

  // The track is the one tab stop: arrow keys, Home and End step through it; Enter selects. With href it is a
  // link, so the browser's own link behaviour (new tab, middle click) works.
  const tabbable = options.tabbable !== false;
  const track: HTMLElement = options.href
    ? el("a", "fk-track fk-link", { href: options.href, draggable: "false", "aria-label": L.region, ...(tabbable ? {} : { tabindex: "-1" }) })
    : el("div", "fk-track", { tabindex: tabbable ? "0" : "-1", "aria-label": `${L.region}, ${L.hint}` });
  if (options.snap === "proximity") track.classList.add("fk-proximity");
  if (options.zoomCursor) track.classList.add("fk-zoom-cursor");
  const imgs = photos.map((p, i) => {
    const img = el("img", "fk-photo", { alt: p.alt ?? "", draggable: "false", decoding: "async" });
    img.width = p.width ?? 1200;
    img.height = p.height ?? 900;
    img.loading = options.priority && i === 0 ? "eager" : "lazy";
    if (options.priority && i === 0) img.setAttribute("fetchpriority", "high");
    if (p.sizes) img.sizes = p.sizes;
    placeholderStyle(img, p.placeholder);
    img.addEventListener("error", () => emit("onError", { index: i, src: p.src, reason: "load" }), { once: true });
    track.append(img);
    return img;
  });
  const loaded = new Set<number>();
  const load = (i: number) => {
    if (loaded.has(i) || !photos[i]) return;
    loaded.add(i);
    const p = photos[i];
    if (p.srcset) imgs[i].srcset = p.srcset;
    imgs[i].src = p.src;
  };
  // The starting photo loads with the page; the rest wait until the slider is near.
  load(at);
  // A photo the server rendered (React) stays until ours has decoded, so the first paint is never empty.
  const ssr = root.querySelector<HTMLImageElement>(":scope > .fk-ssr");
  const ready = () => root.classList.add("fk-ready");
  if (ssr && typeof imgs[at]?.decode === "function") imgs[at].decode().then(ready, ready); else ready();
  let near = false;
  const loadAll = () => { for (let i = 0; i < n; i++) load(i); };
  const io = typeof IntersectionObserver === "function"
    ? new IntersectionObserver((es) => {
        near = es.some((e) => e.isIntersecting);
        if (near) loadAll();
        sync();
      }, { rootMargin: options.lazyMargin ?? "100px" })
    : null;
  if (io) io.observe(root); else { near = true; loadAll(); }

  const added: Element[] = [track];
  root.append(track);

  let dots: HTMLElement[] = [];
  if (options.dots !== false && n > 1) {
    const wrap = el("div", "fk-dots", { "aria-hidden": "true" });
    dots = photos.map(() => wrap.appendChild(el("i", "fk-dot")));
    root.append(wrap);
    added.push(wrap);
  }
  let count: HTMLElement | null = null;
  if (options.counter && n > 1) {
    count = el("span", "fk-count", { "aria-hidden": "true" });
    root.append(count);
    added.push(count);
  }
  const ic = options.icons ?? {};
  let prevBtn: HTMLButtonElement | null = null, nextBtn: HTMLButtonElement | null = null;
  if (options.arrows !== false && n > 1) {
    // Mouse helpers, out of the tab order: the track already takes the arrow keys.
    prevBtn = el("button", "fk-arrow fk-prev", { type: "button", "aria-label": L.previous, tabindex: "-1" });
    nextBtn = el("button", "fk-arrow fk-next", { type: "button", "aria-label": L.next, tabindex: "-1" });
    prevBtn.append(icon(ic.prev ?? CHEVRON_LEFT, 16));
    nextBtn.append(icon(ic.next ?? CHEVRON, 16));
    prevBtn.addEventListener("click", () => step(-1, "button"));
    nextBtn.addEventListener("click", () => step(1, "button"));
    root.append(prevBtn, nextBtn);
    added.push(prevBtn, nextBtn);
  }
  const status = el("span", "fk-sr", announce ? { "aria-live": "polite", "aria-atomic": "true" } : {});
  root.append(status);
  added.push(status);

  const rtl = () => getComputedStyle(track).direction === "rtl";
  const paint = (say: boolean) => {
    dots.forEach((d, i) => d.classList.toggle("fk-on", i === at));
    if (count) count.textContent = fill(L.counter, { n: at + 1, total: n });
    prevBtn?.classList.toggle("fk-end", !loop && at === 0);
    nextBtn?.classList.toggle("fk-end", !loop && at === n - 1);
    imgs.forEach((img, i) => img.setAttribute("aria-hidden", i === at ? "false" : "true"));
    if (say && announce && n > 1) status.textContent = fill(L.position, { n: at + 1, total: n });
  };
  paint(false);

  // Movement: one start and one end per stretch of scrolling.
  let moving = false, idle = 0, frame = 0;
  const settle = () => {
    clearTimeout(idle);
    if (!moving) return;
    moving = false;
    emit("onAnimationEnd", { type: "slide", index: at });
  };
  const onScroll = () => {
    if (!moving) { moving = true; emit("onAnimationStart", { type: "slide", index: at }); }
    clearTimeout(idle);
    idle = window.setTimeout(settle, 140);
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const i = indexAt(track.scrollLeft, track.clientWidth, n);
      if (i !== at) {
        const from = at;
        at = i;
        load(i); load(i + 1);
        unzoom();
        paint(true);
        emit("onSlideChange", { index: i, from }, i, { index: i, from });
        emit("onChange", { index: i, from }, i, { index: i, from });
      }
    });
  };
  const go = (i: number, smooth = true) => {
    const t = clampIndex(i, n);
    load(t);
    track.scrollTo({ left: t * track.clientWidth * (rtl() ? -1 : 1), behavior: smooth && !reduced() ? "smooth" : "auto" });
  };
  const step = (d: 1 | -1, _how: SlideHow, wrap = loop) => {
    const t = nextIndex(at, d, n, wrap);
    if (t !== null) go(t);
  };

  // Autoplay: off unless asked, never with reduced motion, and paused while someone is looking closely.
  const every = typeof options.autoplay === "number" && options.autoplay > 0 && n > 1 ? Math.max(1500, options.autoplay) : 0;
  let playing = every > 0, timer = 0, hover = false, focus = false;
  let playBtn: HTMLButtonElement | null = null;
  const sync = () => {
    clearInterval(timer); timer = 0;
    const run = playing && near && !hover && !focus && !document.hidden && !reduced();
    if (run) timer = window.setInterval(() => step(1, "autoplay", true), every);
    if (playBtn) {
      playBtn.replaceChildren(icon(playing ? ic.pause ?? PAUSE : ic.play ?? PLAY, 14));
      playBtn.setAttribute("aria-label", playing ? L.pause : L.play);
      playBtn.hidden = reduced();
    }
  };
  if (every) {
    playBtn = el("button", "fk-play", { type: "button" });
    playBtn.addEventListener("click", () => { playing = !playing; sync(); });
    root.append(playBtn);
    added.push(playBtn);
  }
  const enter = () => { hover = true; sync(); };
  const leave = () => { hover = false; sync(); };
  const fin = () => { focus = true; loadAll(); sync(); };
  const fout = (e: FocusEvent) => { if (!root.contains(e.relatedTarget as Node)) { focus = false; sync(); } };
  const vis = () => sync();

  const select = (e: MouseEvent | KeyboardEvent | PointerEvent) => options.onSelect?.(at, imgs[at], e);
  const onKey = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const act = sliderKey(e.key, rtl());
    if (!act) return;
    // On a link, Enter is the browser's (it clicks the link, which reaches onSelect through the click).
    if (act === "select" && options.href) return;
    e.preventDefault();
    if (act === "next") step(1, "key");
    else if (act === "prev") step(-1, "key");
    else if (act === "first") go(0);
    else if (act === "last") go(n - 1);
    else select(e);
  };

  // Zoom (option zoom): pinch toward the fingers, spring back on release; double tap toggles 2x at the tap. With
  // zoom on, a single touch tap waits a moment to see if a second follows.
  const DOUBLE_MS = 280, DOUBLE_PX = 30;
  let zoomed: HTMLImageElement | null = null;
  const unzoom = () => {
    if (!zoomed) return;
    zoomed.style.transform = "";
    zoomed = null;
  };
  let pinch: { img: HTMLImageElement; d0: number; m0: { x: number; y: number } } | null = null;
  const pt = (t: Touch) => ({ x: t.clientX, y: t.clientY });
  const onTouchStart = (e: TouchEvent) => {
    if (!options.zoom || e.touches.length !== 2) return;
    const img = imgs[at];
    e.preventDefault();
    const a = pt(e.touches[0]), b = pt(e.touches[1]);
    const r = img.getBoundingClientRect();
    const m0 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    img.classList.add("fk-pinching");
    img.style.transformOrigin = `${m0.x - r.left}px ${m0.y - r.top}px`;
    track.style.overflowX = "hidden";
    pinch = { img, d0: Math.hypot(a.x - b.x, a.y - b.y), m0 };
  };
  const onTouchMove = (e: TouchEvent) => {
    if (!pinch || e.touches.length < 2) return;
    e.preventDefault();
    const a = pt(e.touches[0]), b = pt(e.touches[1]);
    const s = Math.max(0.85, Math.min(4, Math.hypot(a.x - b.x, a.y - b.y) / pinch.d0));
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    pinch.img.style.transform = `translate3d(${m.x - pinch.m0.x}px, ${m.y - pinch.m0.y}px, 0) scale(${s})`;
  };
  const onTouchEnd = (e: TouchEvent) => {
    if (!pinch || e.touches.length >= 2) return;
    const img = pinch.img;
    pinch = null;
    img.classList.remove("fk-pinching");
    img.style.transform = "";
    zoomed = null;
    track.style.overflowX = "";
    swallowClick = true;
  };
  let swallowClick = false;
  let lastTap: { t: number; x: number; y: number; timer: number } | null = null;
  const onClick = (e: MouseEvent) => {
    if (swallowClick) { swallowClick = false; e.preventDefault(); return; }
    if (!(e.target as Element).closest?.(".fk-photo")) return;
    const touchTap = options.zoom && lastPointer !== "mouse" && e.detail <= 1 && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0;
    if (!touchTap) {
      // Mouse: a double click zooms; single clicks select at once (the browser keeps link clicks as they are).
      if (options.zoom && e.detail === 2) { e.preventDefault(); toggleZoom(e.clientX, e.clientY); return; }
      if (options.onSelect) select(e);
      return;
    }
    // Touch with zoom: wait to see if this is a double tap.
    e.preventDefault();
    const now = e.timeStamp;
    if (lastTap && now - lastTap.t < DOUBLE_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < DOUBLE_PX) {
      clearTimeout(lastTap.timer);
      lastTap = null;
      toggleZoom(e.clientX, e.clientY);
      return;
    }
    const href = options.href;
    lastTap = { t: now, x: e.clientX, y: e.clientY, timer: window.setTimeout(() => {
      lastTap = null;
      if (zoomed) return;
      if (options.onSelect) select(e);
      if (href && !e.defaultPrevented) location.assign(href);
    }, DOUBLE_MS) };
  };
  const toggleZoom = (x: number, y: number) => {
    const img = imgs[at];
    if (zoomed) { unzoom(); return; }
    const r = img.getBoundingClientRect();
    img.style.transformOrigin = `${x - r.left}px ${y - r.top}px`;
    img.style.transform = "scale(2)";
    zoomed = img;
  };
  // Which kind of pointer made the click (Safari's click is not always a PointerEvent).
  let lastPointer = "mouse";
  const touch = (e: PointerEvent) => { lastPointer = e.pointerType || "mouse"; loadAll(); };

  track.addEventListener("scroll", onScroll, { passive: true });
  track.addEventListener("scrollend", settle);
  track.addEventListener("keydown", onKey);
  track.addEventListener("click", onClick);
  if (options.zoom) {
    track.addEventListener("touchstart", onTouchStart, { passive: false });
    track.addEventListener("touchmove", onTouchMove, { passive: false });
    track.addEventListener("touchend", onTouchEnd);
    track.addEventListener("touchcancel", onTouchEnd);
  }
  root.addEventListener("pointerdown", touch, { passive: true });
  root.addEventListener("pointerenter", enter);
  root.addEventListener("pointerleave", leave);
  root.addEventListener("focusin", fin);
  root.addEventListener("focusout", fout);
  document.addEventListener("visibilitychange", vis);
  sync();

  // Start on a later photo without animating there.
  if (at > 0) requestAnimationFrame(() => go(at, false));

  return {
    get index() { return at; },
    el: root,
    go,
    next: () => step(1, "api"),
    prev: () => step(-1, "api"),
    play: () => { if (every) { playing = true; sync(); } },
    pause: () => { playing = false; sync(); },
    image: (i) => imgs[i],
    destroy() {
      cancelAnimationFrame(frame);
      clearTimeout(idle);
      clearInterval(timer);
      io?.disconnect();
      track.removeEventListener("scroll", onScroll);
      root.removeEventListener("pointerdown", touch);
      root.removeEventListener("pointerenter", enter);
      root.removeEventListener("pointerleave", leave);
      root.removeEventListener("focusin", fin);
      root.removeEventListener("focusout", fout);
      document.removeEventListener("visibilitychange", vis);
      if (lastTap) clearTimeout(lastTap.timer);
      added.forEach((a) => a.remove());
      root.classList.remove("fk-procession", "fk-ring-inset", "fk-zoomable", "fk-ready");
      ["role", "aria-roledescription", "aria-label", "data-motion"].forEach((a) => root.removeAttribute(a));
    },
  };
}
