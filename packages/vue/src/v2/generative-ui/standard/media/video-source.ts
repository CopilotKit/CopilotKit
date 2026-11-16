/** A YouTube id is about 11 characters of [A-Za-z0-9_-]. Others are refused. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,20}$/;

/**
 * The id of a YouTube video or short in `url`, or `undefined` for another
 * URL. Accepts watch, embed, shorts, live and youtu.be links.
 *
 * @example youTubeIdOf("https://youtu.be/dQw4w9WgXcQ") // "dQw4w9WgXcQ"
 */
export function youTubeIdOf(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const host = parsed.hostname.replace(/^www\.|^m\./, "");
  let id: string | null | undefined;
  if (host === "youtu.be") {
    id = parsed.pathname.slice(1);
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const match = parsed.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/]+)/);
    id = match ? match[1] : parsed.searchParams.get("v");
  }
  return id && YOUTUBE_ID.test(id) ? id : undefined;
}

const VIDEO_FILE = /\.(mp4|m4v|webm|ogv|ogg|mov|m3u8|mpd)$/i;
/** Video sites whose pages the native player cannot play. */
const VIDEO_PAGE_HOSTS = [
  "youtube.com",
  "youtube-nocookie.com",
  "youtu.be",
  "vimeo.com",
  "dailymotion.com",
  "twitch.tv",
  "tiktok.com",
  "loom.com",
  "wistia.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
];

/**
 * How to show a video URL: the YouTube embed, the native player for a file
 * (a known extension, or any URL that is not a page of a video site), or a
 * link for a page the player cannot play. A URL that does not parse is a
 * file: the player reports the failure, and the link takes its place.
 *
 * @example videoSourceOf("https://vimeo.com/123") // "page"
 */
export function videoSourceOf(url: string) {
  if (youTubeIdOf(url) !== undefined) return "youtube";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "file";
  }
  if (VIDEO_FILE.test(parsed.pathname)) return "file";
  const host = parsed.hostname.replace(/^www\.|^m\./, "");
  const isPage = VIDEO_PAGE_HOSTS.some(
    (site) => host === site || host.endsWith(`.${site}`),
  );
  return isPage ? "page" : "file";
}

/** How a Video shows its URL. See `videoSourceOf`. */
export type VideoSource = ReturnType<typeof videoSourceOf>;
