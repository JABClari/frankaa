// procession: a photo slider on a native scroll-snap track. A swipe follows the finger 1:1 and keeps its
// momentum because the browser does the scrolling; we only read where it landed. Dots follow the scroll,
// arrows show on hover with a mouse and step one photo, and photos past the first load only once the slider
// comes near the screen (or is touched).
import { clampIndex, indexAt } from "./slider-math";

export type Photo = {
  src: string;
  srcset?: string;
  sizes?: string;
  alt?: string;
  width?: number;
  height?: number;
};

export type ProcessionOptions = {
  /** The photos, in order. Strings are taken as `src`. */
  photos: (Photo | string)[];
  /** The slider's accessible name. Default "Photos". */
  label?: string;
  /** The photo to start on. Default 0. */
  start?: number;
  /** Show the dots. Default true (only with two or more photos). */
  dots?: boolean;
  /** Show the previous and next arrows on hover (mouse) and keyboard focus. Default true. */
  arrows?: boolean;
  /** The first photo is above the fold: load it at once, first in line. Default false. */
  priority?: boolean;
  /** How near the screen the slider must come before the other photos load. Default "100px". */
  lazyMargin?: string;
  /** Called when the photo showing changes. */
  onChange?: (index: number) => void;
  /** Called on a click, or Enter, on the photo showing (for example to open the lightbox). */
  onSelect?: (index: number, img: HTMLImageElement) => void;
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
  /** The image element for photo i. */
  image(i: number): HTMLImageElement | undefined;
  /** Remove what the slider added and stop listening. */
  destroy(): void;
};

const ARROW = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const toPhoto = (p: Photo | string): Photo => (typeof p === "string" ? { src: p } : p);
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

/** Turn an element into a photo slider. The element's own children are left alone; the slider adds its own. */
export function procession(root: HTMLElement, options: ProcessionOptions): Procession {
  const photos = options.photos.map(toPhoto);
  const n = photos.length;
  const label = options.label ?? "Photos";
  const showDots = options.dots !== false && n > 1;
  const showArrows = options.arrows !== false && n > 1;
  let at = clampIndex(options.start ?? 0, n);

  root.classList.add("fk-procession");
  root.setAttribute("role", "region");
  root.setAttribute("aria-roledescription", "carousel");
  root.setAttribute("aria-label", label);

  // The track is the one tab stop: arrow keys, Home and End step through it; Enter selects.
  const track = el("div", "fk-track", { tabindex: "0", "aria-label": `${label}, use the arrow keys to move` });
  if (options.onSelect) track.classList.add("fk-selectable");
  const imgs = photos.map((p, i) => {
    const img = el("img", "fk-photo", { alt: p.alt ?? "", draggable: "false", decoding: "async" });
    img.width = p.width ?? 1200;
    img.height = p.height ?? 900;
    img.loading = options.priority && i === 0 ? "eager" : "lazy";
    if (options.priority && i === 0) img.setAttribute("fetchpriority", "high");
    if (p.sizes) img.sizes = p.sizes;
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
  let io: IntersectionObserver | null = null;
  const loadAll = () => { for (let i = 0; i < n; i++) load(i); io?.disconnect(); io = null; };
  if (n > 1) {
    if (typeof IntersectionObserver === "function") {
      io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && loadAll(), { rootMargin: options.lazyMargin ?? "100px" });
      io.observe(root);
    } else loadAll();
  }

  const added: Element[] = [track];
  root.append(track);

  let dots: HTMLElement[] = [];
  if (showDots) {
    const wrap = el("div", "fk-dots", { "aria-hidden": "true" });
    dots = photos.map(() => wrap.appendChild(el("i", "fk-dot")));
    root.append(wrap);
    added.push(wrap);
  }
  let prevBtn: HTMLButtonElement | null = null, nextBtn: HTMLButtonElement | null = null;
  if (showArrows) {
    // Mouse helpers, out of the tab order: the track already takes the arrow keys.
    prevBtn = el("button", "fk-arrow fk-prev", { type: "button", "aria-label": "Previous photo", tabindex: "-1" });
    nextBtn = el("button", "fk-arrow fk-next", { type: "button", "aria-label": "Next photo", tabindex: "-1" });
    prevBtn.innerHTML = nextBtn.innerHTML = ARROW;
    prevBtn.addEventListener("click", () => step(-1));
    nextBtn.addEventListener("click", () => step(1));
    root.append(prevBtn, nextBtn);
    added.push(prevBtn, nextBtn);
  }
  const status = el("span", "fk-sr", { "aria-live": "polite", "aria-atomic": "true" });
  root.append(status);
  added.push(status);

  const rtl = () => getComputedStyle(track).direction === "rtl";
  const paint = (announce: boolean) => {
    dots.forEach((d, i) => d.classList.toggle("fk-on", i === at));
    prevBtn?.classList.toggle("fk-end", at === 0);
    nextBtn?.classList.toggle("fk-end", at === n - 1);
    imgs.forEach((img, i) => img.setAttribute("aria-hidden", i === at ? "false" : "true"));
    if (announce && n > 1) status.textContent = `Photo ${at + 1} of ${n}`;
  };
  paint(false);

  let frame = 0;
  const onScroll = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const i = indexAt(track.scrollLeft, track.clientWidth, n);
      if (i !== at) {
        at = i;
        load(i); load(i + 1);
        paint(true);
        options.onChange?.(i);
      }
    });
  };
  const go = (i: number, smooth = true) => {
    const t = clampIndex(i, n);
    load(t);
    const left = t * track.clientWidth * (rtl() ? -1 : 1);
    track.scrollTo({ left, behavior: smooth && !reduced() ? "smooth" : "auto" });
  };
  const step = (d: 1 | -1) => go(at + d);

  const onKey = (e: KeyboardEvent) => {
    const back = rtl() ? "ArrowRight" : "ArrowLeft", fwd = rtl() ? "ArrowLeft" : "ArrowRight";
    if (e.key === fwd) step(1);
    else if (e.key === back) step(-1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(n - 1);
    else if (e.key === "Enter" && options.onSelect) options.onSelect(at, imgs[at]);
    else return;
    e.preventDefault();
  };
  const onClick = (e: MouseEvent) => {
    const img = (e.target as Element).closest?.(".fk-photo");
    if (img && options.onSelect) options.onSelect(at, imgs[at]);
  };
  const touch = () => loadAll();

  track.addEventListener("scroll", onScroll, { passive: true });
  track.addEventListener("keydown", onKey);
  track.addEventListener("click", onClick);
  root.addEventListener("pointerdown", touch, { passive: true });
  root.addEventListener("focusin", touch);

  // Start on a later photo without animating there.
  if (at > 0) requestAnimationFrame(() => go(at, false));

  return {
    get index() { return at; },
    el: root,
    go,
    next: () => step(1),
    prev: () => step(-1),
    image: (i) => imgs[i],
    destroy() {
      cancelAnimationFrame(frame);
      io?.disconnect();
      track.removeEventListener("scroll", onScroll);
      root.removeEventListener("pointerdown", touch);
      root.removeEventListener("focusin", touch);
      added.forEach((a) => a.remove());
      root.classList.remove("fk-procession");
      ["role", "aria-roledescription", "aria-label"].forEach((a) => root.removeAttribute(a));
    },
  };
}
