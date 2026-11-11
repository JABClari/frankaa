// Video items for the lightbox: which provider, and the embed address for it. Pure, so it runs under node --test.
// Only ids that match each provider's shape are used, so no other address can be loaded through a video item.

export type MediaProvider = "youtube" | "vimeo" | "tiktok" | "instagram" | "mp4";

const YT = /^[\w-]{11}$/;
const NUM = /^\d{4,20}$/;
const IG = /^[\w-]{5,40}$/;

const parse = (src: string): URL | null => {
  try { return new URL(src, "https://x.invalid/"); } catch { return null; }
};

/** The video's id for a provider, from a full link or the bare id; null when it does not look right. */
export function videoId(provider: MediaProvider, src: string): string | null {
  const s = src.trim();
  if (provider === "youtube") {
    if (YT.test(s)) return s;
    const u = parse(s);
    if (!u) return null;
    const v = u.hostname.endsWith("youtu.be") ? u.pathname.slice(1) : u.searchParams.get("v") ?? u.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{11})/)?.[1] ?? "";
    return YT.test(v) ? v : null;
  }
  if (provider === "vimeo") {
    if (NUM.test(s)) return s;
    const id = parse(s)?.pathname.match(/\/(?:video\/)?(\d{4,20})(?:\/|$)/)?.[1] ?? "";
    return NUM.test(id) ? id : null;
  }
  if (provider === "tiktok") {
    if (NUM.test(s)) return s;
    const id = parse(s)?.pathname.match(/\/(?:video|v)\/(\d{4,20})/)?.[1] ?? "";
    return NUM.test(id) ? id : null;
  }
  if (provider === "instagram") {
    if (IG.test(s)) return s;
    const id = parse(s)?.pathname.match(/\/(?:p|reel|tv)\/([\w-]{5,40})/)?.[1] ?? "";
    return IG.test(id) ? id : null;
  }
  return null;
}

/**
 * The address to embed: privacy-friendly players where the provider has one (youtube-nocookie.com, Vimeo with
 * dnt=1), and the official embed pages for TikTok and Instagram. For mp4, the file's own address (http or https,
 * or relative). Null when the source is not usable.
 */
export function embedUrl(provider: MediaProvider, src: string): string | null {
  if (provider === "mp4") {
    const u = parse(src);
    return u && (u.protocol === "https:" || u.protocol === "http:") ? src : null;
  }
  const id = videoId(provider, src);
  if (!id) return null;
  if (provider === "youtube") return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0&modestbranding=1`;
  if (provider === "vimeo") {
    const h = parse(src)?.searchParams.get("h");
    return `https://player.vimeo.com/video/${id}?autoplay=1&dnt=1${h && /^[\da-f]{6,20}$/i.test(h) ? `&h=${h}` : ""}`;
  }
  if (provider === "tiktok") return `https://www.tiktok.com/embed/v2/${id}`;
  return `https://www.instagram.com/p/${id}/embed/`;
}
