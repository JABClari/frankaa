// Pure helpers for the slider (procession). No DOM here, so they run under node --test.
// Functions starting with "worklet" also run on the UI thread in frankaa/native (Reanimated); the web build strips it.

/** The photo a scroll-snap track is showing: its scroll offset over one photo's width, clamped. */
export function indexAt(scroll: number, width: number, count: number): number {
  if (!(width > 0) || count < 1) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(Math.abs(scroll) / width)));
}

/** Clamp a wanted photo index into the list. */
export function clampIndex(i: number, count: number): number {
  "worklet";
  if (count < 1 || !Number.isFinite(i)) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(i)));
}

/** The slider's labels: the default English strings. */
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
