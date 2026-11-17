// The lightbox's labels: the default English strings. Pure, so frankaa/native shares them; a module of its own so
// the strip and the slider, which share lightbox-math, do not carry them.
import type { VideoLabels } from "./video-math";

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
  /** Read out when a photo is still loading after loadingDelay. {n}. Default "Loading photo {n}". */
  loading: string;
  /** Shown in the frame of a photo that did not load. Default "This photo didn't load". */
  failed: string;
  /** The button that asks for it again. Default "Retry". */
  retry: string;
} & Omit<VideoLabels, "play">;
export const UNFURL_LABELS: UnfurlLabels = { dialog: "Photos", close: "Close", next: "Next photo", previous: "Previous photo", position: "Photo {n} of {total}", videoPosition: "Video {n} of {total}", play: "Play video", counter: "{n} / {total}", loading: "Loading photo {n}", failed: "This photo didn't load", retry: "Retry", pause: "Pause video", mute: "Mute", unmute: "Unmute", seek: "Seek", volume: "Volume", fullscreen: "Full screen", exitFullscreen: "Exit full screen", timeOf: "{time} of {duration}" };
