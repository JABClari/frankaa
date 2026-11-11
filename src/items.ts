// One item format for every part. procession, unfurl and drumline all take the same list, and each picks the file
// it needs: the slider shows src, the lightbox shows full (or src), and drumline shows thumb (or src).
// Pure, so it runs under node --test.

import type { MediaProvider } from "./media";

export type ImageItem = {
  type?: "image";
  /** The picture. The slider shows it; the lightbox too, unless full is set. */
  src: string;
  /** Sizes of src for the browser to pick from (sizes defaults to what the part needs). */
  srcset?: string;
  sizes?: string;
  /** A small file for strips (drumline, the lightbox's filmstrip). Default src. */
  thumb?: string;
  /** A large file for the lightbox. Default src. */
  full?: string;
  alt?: string;
  caption?: string;
  title?: string;
  width?: number;
  height?: number;
  /** Shown until the picture paints: a colour, or an image address (a tiny thumbnail or a decoded blurhash). */
  placeholder?: string;
  /** Art direction for the slider: other files for other screens, as <source media srcset> in a <picture>. */
  sources?: { media: string; srcset: string; sizes?: string; type?: string }[];
};

/**
 * A video. The poster stands in for it everywhere a picture is drawn (the slider, strips, the lightbox's spring);
 * the lightbox loads the player only when the person taps play.
 */
export type VideoItem = {
  type: "video";
  provider: MediaProvider;
  /** A link to the video, or its id. */
  src: string;
  /** The still that stands in for the video. Optional: without it an mp4 shows its first frame in the lightbox,
   *  and everywhere else a neutral 16:9 still is drawn. */
  poster?: string;
  thumb?: string;
  alt?: string;
  caption?: string;
  title?: string;
  placeholder?: string;
};

export type Item = ImageItem | VideoItem;
/** A list of items; a plain string is an image's src. */
export type Items = ReadonlyArray<Item | string>;

/** A neutral 16:9 still with a play mark, for videos without a poster. */
export const NEUTRAL_POSTER = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#2a2926"/><path d="M740 390v120l104-60z" fill="#8a857c"/></svg>');
const posterOf = (x: VideoItem) => x.poster ?? NEUTRAL_POSTER;

export const toItem = (x: Item | string): Item => (typeof x === "string" ? { src: x } : x);
export const isVideo = (x: Item): x is VideoItem => x.type === "video";
/** The file the slider shows. */
export const slideSrc = (x: Item): string => (isVideo(x) ? posterOf(x) : x.src);
/** The file the lightbox shows (a video's poster until it plays). */
export const fullSrc = (x: Item): string => (isVideo(x) ? posterOf(x) : x.full ?? x.src);
/** The file a strip shows. */
export const thumbSrc = (x: Item): string => x.thumb ?? (isVideo(x) ? posterOf(x) : x.src);

/**
 * Read the two call shapes every part accepts: (items, options) or (options with items). `photos` is the older
 * name for items and still works.
 */
export function readArgs<O extends { items?: Items; photos?: Items }>(a: Items | O, b?: Omit<O, "items" | "photos">): { items: Item[]; options: O } {
  const options = (Array.isArray(a) ? { ...(b ?? {}), items: a } : a) as O;
  const list = options.items ?? options.photos ?? [];
  return { items: list.map(toItem), options };
}
