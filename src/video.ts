// The mp4 player inside the lightbox: frankaa's own controls instead of the browser's, so a tap pauses rather than
// closes, and play, seek, volume and full screen look the same in every browser. Built node by node (no innerHTML).
import { PAUSE, PLAY, el, icon } from "./dom";
import { clampTime, formatTime, fraction, playerKey } from "./video-math";

export type VideoLabels = {
  play: string;
  pause: string;
  mute: string;
  unmute: string;
  seek: string;
  volume: string;
  fullscreen: string;
  exitFullscreen: string;
  /** Read out on the seek slider: "{time} of {duration}". */
  timeOf: string;
};

export const VOLUME = "M11 5 6 9H3v6h3l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13";
export const MUTED = "M11 5 6 9H3v6h3l5 4V5zM22 9l-6 6M16 9l6 6";
export const FULLSCREEN = "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5";
export const EXIT_FULLSCREEN = "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5";

export type VideoPlayer = {
  /** The wrapper: the video, the centre flash and the control bar. */
  el: HTMLElement;
  video: HTMLVideoElement;
  toggle(): void;
  /** Handles a key the player owns; returns true when it did. */
  key(e: KeyboardEvent): boolean;
  destroy(): void;
};

// Volume and mute last for the page visit, so the next video plays at the same level.
let lastVolume = 1;
let lastMuted = false;

const IDLE_MS = 2500;
const STEP = 5;
const LONG_STEP = 10;

type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };
type IosVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void; webkitSupportsFullscreen?: boolean };

export function videoPlayer(src: string, opts: { poster?: string; title: string; labels: VideoLabels; reduced: () => boolean; onError: () => void }): VideoPlayer {
  const L = opts.labels;
  const wrap = el("div", "fk-vc", { tabindex: "-1", role: "group", "aria-label": opts.title, "data-paused": "true" });
  const video = el("video", "fk-unfurl-player", { playsinline: "", preload: "auto", ...(opts.poster ? { poster: opts.poster } : {}) }) as IosVideo;
  video.src = src;
  video.volume = lastVolume;
  video.muted = lastMuted;

  const flash = el("span", "fk-vc-flash", { "aria-hidden": "true" });

  const bar = el("div", "fk-vc-bar");
  const playBtn = el("button", "fk-vc-btn fk-vc-toggle", { type: "button" });
  const time = el("span", "fk-vc-time", { "aria-hidden": "true" });
  const seek = el("input", "fk-vc-range fk-vc-seek", { type: "range", min: "0", max: "0", step: "any", value: "0", "aria-label": L.seek });
  const total = el("span", "fk-vc-time", { "aria-hidden": "true" });
  const muteBtn = el("button", "fk-vc-btn fk-vc-mute", { type: "button" });
  const vol = el("input", "fk-vc-range fk-vc-vol", { type: "range", min: "0", max: "1", step: "0.05", "aria-label": L.volume });
  const volBox = el("div", "fk-vc-volume");
  volBox.append(muteBtn, vol);
  const fsBtn = el("button", "fk-vc-btn fk-vc-fs", { type: "button" });
  bar.append(playBtn, time, seek, total, volBox, fsBtn);
  wrap.append(video, flash, bar);

  const doc = document as FsDoc;
  const fsElement = () => doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
  const canFs = !!((wrap as FsEl).requestFullscreen || (wrap as FsEl).webkitRequestFullscreen || video.webkitEnterFullscreen);
  if (!canFs) fsBtn.hidden = true;

  // ---------- State to screen ----------
  const setIcon = (b: HTMLElement, d: string, label: string, filled = false) => {
    const svg = icon(d, 18);
    if (filled) svg.classList.add("fk-vc-fill");
    b.replaceChildren(svg);
    b.setAttribute("aria-label", label);
  };
  const paintPlay = () => {
    const paused = video.paused || video.ended;
    wrap.dataset.paused = String(paused);
    setIcon(playBtn, paused ? PLAY : PAUSE, paused ? L.play : L.pause, paused);
    if (paused) wake();
  };
  const paintVolume = () => {
    const silent = video.muted || video.volume === 0;
    setIcon(muteBtn, silent ? MUTED : VOLUME, silent ? L.unmute : L.mute);
    vol.value = String(video.muted ? 0 : video.volume);
    vol.style.setProperty("--fk-vc-p", String(video.muted ? 0 : video.volume));
  };
  const paintFs = () => {
    const on = fsElement() === wrap;
    setIcon(fsBtn, on ? EXIT_FULLSCREEN : FULLSCREEN, on ? L.exitFullscreen : L.fullscreen);
  };
  let scrubbing = false;
  const paintTime = () => {
    const d = video.duration;
    const t = scrubbing ? Number(seek.value) : video.currentTime;
    if (Number.isFinite(d) && seek.max !== String(d)) seek.max = String(d);
    if (!scrubbing) seek.value = String(t);
    time.textContent = formatTime(t);
    total.textContent = formatTime(d);
    seek.style.setProperty("--fk-vc-p", String(fraction(t, d)));
    const b = video.buffered;
    seek.style.setProperty("--fk-vc-b", String(b.length ? fraction(b.end(b.length - 1), d) : 0));
    seek.setAttribute("aria-valuetext", L.timeOf.replace("{time}", formatTime(t)).replace("{duration}", formatTime(d)));
  };

  // While playing, follow the frame clock so the bar moves smoothly (timeupdate alone ticks about four times a second).
  let raf = 0;
  const tick = () => { paintTime(); raf = video.paused ? 0 : requestAnimationFrame(tick); };
  const startTick = () => { if (!raf) raf = requestAnimationFrame(tick); };

  // ---------- The bar hides while a video plays untouched, and comes back on any movement or focus ----------
  let idleTimer = 0;
  const wake = () => {
    delete wrap.dataset.idle;
    clearTimeout(idleTimer);
    if (!video.paused && !scrubbing && !wrap.matches(":focus-within") ) idleTimer = window.setTimeout(() => { wrap.dataset.idle = "true"; }, IDLE_MS);
  };

  // ---------- Actions ----------
  const pulse = (d: string) => {
    if (opts.reduced()) return;
    const svg = icon(d, 30);
    if (d === PLAY) svg.classList.add("fk-vc-fill");
    flash.replaceChildren(svg);
    flash.classList.remove("fk-vc-flash-on");
    void flash.offsetWidth; // restart the animation
    flash.classList.add("fk-vc-flash-on");
  };
  const toggle = () => {
    if (video.paused || video.ended) { video.play().catch(() => { /* blocked or no source: the play button stays */ }); pulse(PLAY); }
    else { video.pause(); pulse(PAUSE); }
    wake();
  };
  const seekTo = (t: number) => { video.currentTime = clampTime(t, video.duration); paintTime(); wake(); };
  const setMuted = (m: boolean) => {
    video.muted = m;
    if (!m && video.volume === 0) video.volume = lastVolume || 0.5;
    lastMuted = video.muted;
    paintVolume();
  };
  const toggleFs = () => {
    if (fsElement()) { (doc.exitFullscreen ?? doc.webkitExitFullscreen)?.call(doc); return; }
    const w = wrap as FsEl;
    if (w.requestFullscreen) w.requestFullscreen().catch(() => video.webkitEnterFullscreen?.());
    else if (w.webkitRequestFullscreen) w.webkitRequestFullscreen();
    else video.webkitEnterFullscreen?.(); // iPhone: only the video itself goes full screen, with the system controls
  };

  playBtn.addEventListener("click", toggle);
  muteBtn.addEventListener("click", () => setMuted(!(video.muted || video.volume === 0)));
  fsBtn.addEventListener("click", toggleFs);
  seek.addEventListener("input", () => { scrubbing = true; seekTo(Number(seek.value)); });
  seek.addEventListener("change", () => { scrubbing = false; paintTime(); wake(); });
  vol.addEventListener("input", () => {
    const v = Number(vol.value);
    video.volume = v;
    video.muted = v === 0;
    if (v > 0) lastVolume = v;
    lastMuted = video.muted;
    paintVolume();
    wake();
  });

  const on = (t: EventTarget, type: string, fn: () => void) => { t.addEventListener(type, fn); return () => t.removeEventListener(type, fn); };
  const offs = [
    on(video, "play", () => { paintPlay(); startTick(); }),
    on(video, "pause", paintPlay),
    on(video, "ended", paintPlay),
    on(video, "loadedmetadata", paintTime),
    on(video, "durationchange", paintTime),
    on(video, "progress", paintTime),
    on(video, "timeupdate", () => { if (!raf) paintTime(); }),
    on(video, "volumechange", paintVolume),
    on(video, "error", opts.onError),
    on(wrap, "pointermove", wake),
    on(wrap, "focusin", wake),
    on(wrap, "focusout", wake),
    on(document, "fullscreenchange", paintFs),
    on(document, "webkitfullscreenchange", paintFs),
  ];

  paintPlay();
  paintVolume();
  paintFs();
  paintTime();
  video.autoplay = true;

  return {
    el: wrap,
    video,
    toggle,
    key(e) {
      const onSlider = (e.target as Element)?.classList?.contains("fk-vc-range");
      const act = playerKey(e.key);
      if (!act) return false;
      // The sliders keep their own arrows; Space on a button presses that button.
      if (onSlider && (act === "back" || act === "forward")) return false;
      if (act === "toggle" && e.key === " " && (e.target as Element)?.closest?.("button")) return false;
      if (act === "toggle") toggle();
      else if (act === "back") seekTo(video.currentTime - STEP);
      else if (act === "forward") seekTo(video.currentTime + STEP);
      else if (act === "back-long") seekTo(video.currentTime - LONG_STEP);
      else if (act === "forward-long") seekTo(video.currentTime + LONG_STEP);
      else if (act === "mute") setMuted(!(video.muted || video.volume === 0));
      else if (act === "fullscreen" && canFs) toggleFs();
      return true;
    },
    destroy() {
      cancelAnimationFrame(raf);
      clearTimeout(idleTimer);
      offs.forEach((off) => off());
      if (fsElement() === wrap) (doc.exitFullscreen ?? doc.webkitExitFullscreen)?.call(doc);
      video.pause();
      video.removeAttribute("src");
      video.load(); // drop the network connection
    },
  };
}
