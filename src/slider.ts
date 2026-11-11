// procession: a photo slider on a native scroll-snap track. A swipe follows the finger 1:1 and keeps its
// momentum because the browser does the scrolling; we only read where it landed. Dots follow the scroll, arrows
// show on hover with a mouse and step one photo, and photos past the first load only once the slider comes near
// the screen (or is touched). Optional: loop, autoplay (off by default, with a pause button), proximity snap.
import { clampIndex, indexAt } from "./slider-math";
import { fill, nextIndex, resolveReduced, type ReducedMotion } from "./shared";
import { CHEVRON, PAUSE, PLAY, el, emitter, icon, systemReduces } from "./dom";

export type Photo = {
  src: string;
  srcset?: string;
  sizes?: string;
  alt?: string;
  width?: number;
  height?: number;
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
};
export const PROCESSION_LABELS: ProcessionLabels = { region: "Photos", hint: "use the arrow keys to move", next: "Next photo", previous: "Previous photo", pause: "Pause slideshow", play: "Play slideshow", position: "Photo {n} of {total}" };

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
  /** Click or Enter on the photo showing (for example to open the lightbox). */
  onSelect?: (index: number, img: HTMLImageElement) => void;
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

  // The track is the one tab stop: arrow keys, Home and End step through it; Enter selects.
  const track = el("div", "fk-track", { tabindex: "0", "aria-label": `${L.region}, ${L.hint}` });
  if (options.snap === "proximity") track.classList.add("fk-proximity");
  if (options.onSelect) track.classList.add("fk-selectable");
  const imgs = photos.map((p, i) => {
    const img = el("img", "fk-photo", { alt: p.alt ?? "", draggable: "false", decoding: "async" });
    img.width = p.width ?? 1200;
    img.height = p.height ?? 900;
    img.loading = options.priority && i === 0 ? "eager" : "lazy";
    if (options.priority && i === 0) img.setAttribute("fetchpriority", "high");
    if (p.sizes) img.sizes = p.sizes;
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
  let prevBtn: HTMLButtonElement | null = null, nextBtn: HTMLButtonElement | null = null;
  if (options.arrows !== false && n > 1) {
    // Mouse helpers, out of the tab order: the track already takes the arrow keys.
    prevBtn = el("button", "fk-arrow fk-prev", { type: "button", "aria-label": L.previous, tabindex: "-1" });
    nextBtn = el("button", "fk-arrow fk-next", { type: "button", "aria-label": L.next, tabindex: "-1" });
    prevBtn.append(icon(CHEVRON, 16));
    nextBtn.append(icon(CHEVRON, 16));
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
      playBtn.replaceChildren(icon(playing ? PAUSE : PLAY, 14));
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

  const onKey = (e: KeyboardEvent) => {
    const back = rtl() ? "ArrowRight" : "ArrowLeft", fwd = rtl() ? "ArrowLeft" : "ArrowRight";
    if (e.key === fwd) step(1, "key");
    else if (e.key === back) step(-1, "key");
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(n - 1);
    else if (e.key === "Enter" && options.onSelect) options.onSelect(at, imgs[at]);
    else return;
    e.preventDefault();
  };
  const onClick = (e: MouseEvent) => {
    if ((e.target as Element).closest?.(".fk-photo") && options.onSelect) options.onSelect(at, imgs[at]);
  };
  const touch = () => loadAll();

  track.addEventListener("scroll", onScroll, { passive: true });
  track.addEventListener("scrollend", settle);
  track.addEventListener("keydown", onKey);
  track.addEventListener("click", onClick);
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
      added.forEach((a) => a.remove());
      root.classList.remove("fk-procession");
      ["role", "aria-roledescription", "aria-label"].forEach((a) => root.removeAttribute(a));
    },
  };
}
