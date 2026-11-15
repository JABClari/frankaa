// The loading view laid over the photo's box, the same for both renderers: a small ring (bottom right) that comes in
// only after the delay and completes when the photo arrives, the "didn't load" message with Retry, aria-busy, the
// screen-reader label, and the host for your own loading view. The renderers draw the material under it.
import { el } from "./dom";
import { fill } from "./shared";
import { loadingView, type LoadingRender, type LoadPhase } from "./loading-math";

const NS = "http://www.w3.org/2000/svg";
const ring = () => {
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("focusable", "false");
  for (const cls of ["fk-unfurl-ring-track", "fk-unfurl-ring-arc"]) {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("class", cls);
    c.setAttribute("cx", "12"); c.setAttribute("cy", "12"); c.setAttribute("r", "9");
    c.setAttribute("fill", "none"); c.setAttribute("stroke-width", "2");
    s.append(c);
  }
  return s;
};

export type LoadingUiOptions = {
  labels: { loading: string; failed: string; retry: string };
  delay: number;
  render?: LoadingRender;
  /** The polite live region: the label goes there after the delay, and the failure message on failure. */
  say: (text: string) => void;
  /** What to read once the photo is there (its position and alt). */
  arrived: () => void;
  retry: (i: number) => void;
};

export type LoadingUi = {
  el: HTMLElement;
  /** The phase of the photo on screen now. */
  readonly phase: LoadPhase;
  set(i: number, phase: LoadPhase): void;
  /** Moved to another photo: clear at once. */
  clear(): void;
  destroy(): void;
};

export function loadingUi(o: LoadingUiOptions): LoadingUi {
  const root = el("div", "fk-unfurl-load", { "aria-busy": "false" });
  root.hidden = true;
  const spin = el("span", "fk-unfurl-ring");
  spin.append(ring());
  const fail = el("div", "fk-unfurl-fail");
  const msg = el("p", "fk-unfurl-fail-msg");
  msg.textContent = o.labels.failed;
  const btn = el("button", "fk-unfurl-retry", { type: "button" });
  btn.textContent = o.labels.retry;
  fail.append(msg, btn);
  const custom = o.render ? el("div", "fk-unfurl-load-host") : null;
  root.append(...(custom ? [custom] : [spin, fail]));

  let at = -1, phase: LoadPhase = "idle", since = 0, timer = 0, doneTimer = 0;
  let tidy: (() => void) | void;
  const untidy = () => { try { tidy?.(); } catch (e) { setTimeout(() => { throw e; }); } tidy = undefined; custom?.replaceChildren(); };
  const retry = () => { if (at >= 0 && phase === "failed") o.retry(at); };
  btn.addEventListener("click", retry);

  // Draw the view for the phase and the time since loading began (loading-math decides what shows).
  const paint = () => {
    const v = loadingView(phase, performance.now() - since, o.delay);
    root.dataset.ring = v.ring;
    root.dataset.state = phase;
    root.setAttribute("aria-busy", String(v.busy));
    if (custom) custom.hidden = phase === "loading" && v.ring === "off";
    if (v.announce === "loading") o.say(fill(o.labels.loading, { n: at + 1 }));
    else if (v.announce === "failed") o.say(o.labels.failed);
  };
  const stop = () => { clearTimeout(timer); clearTimeout(doneTimer); timer = doneTimer = 0; };

  return {
    el: root,
    get phase() { return phase; },
    set(i, p) {
      if (p === "loading") {
        stop();
        at = i; phase = "loading"; since = performance.now();
        root.hidden = false;
        if (o.render) { untidy(); tidy = o.render(custom!, { index: i, failed: false, retry }); }
        paint();
        timer = window.setTimeout(paint, o.delay);
      } else if (i === at && phase === "loading" && p === "ready") {
        stop();
        phase = "ready";
        paint();
        o.arrived();
        // The ring completes, fades, and the view goes.
        doneTimer = window.setTimeout(() => { if (phase === "ready") { root.hidden = true; phase = "idle"; untidy(); } }, 700);
      } else if (i === at && p === "failed") {
        stop();
        phase = "failed";
        root.hidden = false;
        if (o.render) { untidy(); tidy = o.render(custom!, { index: i, failed: true, retry }); }
        paint();
      }
    },
    clear() {
      stop();
      at = -1; phase = "idle";
      root.hidden = true;
      root.setAttribute("aria-busy", "false");
      untidy();
    },
    destroy() { stop(); untidy(); root.remove(); },
  };
}
