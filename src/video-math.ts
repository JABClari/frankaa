// Pure helpers for the mp4 player: no DOM, so they run in node tests.

/** 0:07, 2:36, 1:02:05. Unknown or negative lengths read 0:00. */
export function formatTime(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const ss = String(r).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** A seek target kept inside the video. */
export function clampTime(t: number, duration: number): number {
  if (!Number.isFinite(t)) return 0;
  const end = Number.isFinite(duration) && duration > 0 ? duration : 0;
  return Math.min(Math.max(t, 0), end);
}

/** Share of the video played or buffered, 0 to 1, for the bar's fill. */
export function fraction(t: number, duration: number): number {
  return Number.isFinite(duration) && duration > 0 ? Math.min(Math.max(t / duration, 0), 1) : 0;
}

/** Keys the player owns while it has focus. Arrows on the seek or volume slider stay with the slider. */
export type PlayerKeyAction = "toggle" | "back" | "forward" | "back-long" | "forward-long" | "mute" | "fullscreen" | null;
export function playerKey(key: string): PlayerKeyAction {
  switch (key) {
    case " ": case "Spacebar": case "k": case "K": return "toggle";
    case "ArrowLeft": return "back";
    case "ArrowRight": return "forward";
    case "j": case "J": return "back-long";
    case "l": case "L": return "forward-long";
    case "m": case "M": return "mute";
    case "f": case "F": return "fullscreen";
    default: return null;
  }
}
