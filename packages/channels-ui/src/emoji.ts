// packages/channels-ui/src/emoji.ts

/** Platforms that support a normalized emoji token. */
export type EmojiPlatform =
  | "slack"
  | "discord"
  | "telegram"
  | "teams"
  | "whatsapp";

export interface EmojiEntry {
  /** Canonical cross-platform name (matches a `KnownEmoji`). */
  name: KnownEmoji;
  /** Unicode token — the native form for Discord and Telegram. */
  unicode: string;
  /** Slack shortcodes (no colons); index 0 is canonical, the rest are aliases. */
  slack: string[];
  /** Microsoft Teams reaction id used by the Teams API Client. */
  teams: string;
}

/** Starter set; unknown emoji pass through unnormalized as `rawEmoji`. */
export const EMOJI_TABLE = [
  {
    name: "thumbs_up",
    unicode: "👍",
    slack: ["+1", "thumbsup"],
    teams: "like",
  },
  {
    name: "thumbs_down",
    unicode: "👎",
    slack: ["-1", "thumbsdown"],
    teams: "no",
  },
  { name: "heart", unicode: "❤️", slack: ["heart"], teams: "heart" },
  { name: "fire", unicode: "🔥", slack: ["fire"], teams: "fire" },
  { name: "eyes", unicode: "👀", slack: ["eyes"], teams: "eyes" },
  { name: "bug", unicode: "🐛", slack: ["bug"], teams: "bug" },
  {
    name: "check",
    unicode: "✅",
    slack: ["white_check_mark", "heavy_check_mark"],
    teams: "2705_whiteheavycheckmark",
  },
  { name: "cross", unicode: "❌", slack: ["x"], teams: "274c_crossmark" },
  { name: "tada", unicode: "🎉", slack: ["tada"], teams: "1f389_partypopper" },
  { name: "rocket", unicode: "🚀", slack: ["rocket"], teams: "launch" },
  {
    name: "warning",
    unicode: "⚠️",
    slack: ["warning"],
    teams: "26a0_warningsign",
  },
  {
    name: "question",
    unicode: "❓",
    slack: ["question"],
    teams: "2753_blackquestionmarkornament",
  },
  {
    name: "raised_hands",
    unicode: "🙌",
    slack: ["raised_hands"],
    teams: "handsinair",
  },
  { name: "clap", unicode: "👏", slack: ["clap"], teams: "clappinghands" },
  { name: "pray", unicode: "🙏", slack: ["pray"], teams: "foldedhands" },
  {
    name: "smile",
    unicode: "😄",
    slack: ["smile"],
    teams: "grinningfacewithsmilingeyes",
  },
  { name: "thinking", unicode: "🤔", slack: ["thinking_face"], teams: "think" },
  // 🔄 (U+1F504) — the demo's "refresh" reaction (Teams delivers `1f504_refresh`).
  {
    name: "refresh",
    unicode: "🔄",
    slack: ["arrows_counterclockwise"],
    teams: "1f504_refresh",
  },
  // Classic Teams reactions with no existing canonical entry.
  { name: "laugh", unicode: "😆", slack: ["laughing"], teams: "laugh" },
  {
    name: "surprised",
    unicode: "😮",
    slack: ["open_mouth"],
    teams: "surprised",
  },
  { name: "sad", unicode: "😢", slack: ["cry"], teams: "cry" },
  { name: "angry", unicode: "😠", slack: ["angry"], teams: "angry" },
] as const satisfies readonly {
  name: string;
  unicode: string;
  slack: string[];
  teams: string;
}[];

export type KnownEmoji = (typeof EMOJI_TABLE)[number]["name"];

/**
 * Reactions with an explicitly supported Slack and Microsoft Teams mapping.
 *
 * Use these values when one handler must work unchanged across both managed
 * providers. Other {@link EmojiValue} strings are provider-native extensions:
 * branch on `thread.platform` before using them and expect an explicit provider
 * error when that provider does not support the value.
 */
export const PORTABLE_REACTIONS = [
  "thumbs_up",
  "thumbs_down",
  "heart",
  "fire",
  "eyes",
  "refresh",
  "thinking",
  "tada",
] as const satisfies readonly KnownEmoji[];

/** A reaction known to work in both managed Slack and Microsoft Teams. */
export type PortableReaction = (typeof PORTABLE_REACTIONS)[number];

/**
 * Accepts a known canonical name (with autocomplete) or any string. Unknown
 * strings pass through as a platform-native token (custom/server emoji).
 */
export type EmojiValue = KnownEmoji | (string & {});

/** Typed accessor map, e.g. `emoji.thumbs_up`. Each value is its own name. */
export const emoji = Object.freeze(
  Object.fromEntries(EMOJI_TABLE.map((e) => [e.name, e.name])),
) as Record<KnownEmoji, KnownEmoji>;

/** Strip the Unicode variation selector U+FE0F (VS16) wherever it appears. */
const stripVs16 = (token: string): string => token.replace(/\uFE0F/g, "");

const byName = new Map<string, EmojiEntry>(
  EMOJI_TABLE.map((e) => [e.name, e as EmojiEntry]),
);
const slackToName = new Map<string, KnownEmoji>();
const teamsToName = new Map<string, KnownEmoji>();
const unicodeToName = new Map<string, KnownEmoji>();
for (const e of EMOJI_TABLE) {
  unicodeToName.set(e.unicode, e.name);
  // Also index the VS16-stripped form so a bare codepoint (e.g. "❤" without the
  // trailing U+FE0F that the table stores) normalizes to the same name.
  unicodeToName.set(stripVs16(e.unicode), e.name);
  for (const code of e.slack) slackToName.set(code, e.name);
  teamsToName.set(e.teams, e.name);
}

/**
 * Resolves any known emoji form — canonical name, Slack shortcode/alias, or
 * Unicode token — to the platform-native token, or `undefined` if unknown.
 */
export function toPlatformEmoji(
  value: EmojiValue,
  platform: EmojiPlatform,
): string | undefined {
  // Accept any legal `EmojiValue`: canonical name, Slack alias, or Unicode token.
  const name = byName.has(value)
    ? (value as KnownEmoji)
    : (slackToName.get(value) ?? unicodeToName.get(value));
  const entry = name ? byName.get(name) : undefined;
  if (!entry) return undefined;
  if (platform === "slack") return entry.slack[0];
  if (platform === "teams") return entry.teams;
  return entry.unicode;
}

/**
 * Resolve any known emoji form — canonical name, Slack shortcode/alias, or
 * Unicode token (with or without VS16) — to its canonical name,
 * platform-agnostically. Unknown tokens (e.g. custom/server emoji) pass through
 * unchanged. Used to normalize caller-supplied reaction filters so they match
 * the canonical names ingress produces.
 */
export function toCanonicalEmoji(value: EmojiValue): EmojiValue {
  if (byName.has(value)) return value;
  return (
    slackToName.get(value) ??
    unicodeToName.get(value) ??
    unicodeToName.get(stripVs16(value)) ??
    value
  );
}

/**
 * Teams "classic" reactions arrive as bare names (not `<codepoint>_<name>`
 * codes). Map them onto canonical names; `like`/`heart` reuse existing entries.
 */
const teamsClassicToName: Record<string, KnownEmoji> = {
  like: "thumbs_up",
  heart: "heart",
  laugh: "laugh",
  surprised: "surprised",
  sad: "sad",
  angry: "angry",
};

/**
 * Teams modern-emoji token: `<unicode-codepoint-hex>_<name>`, e.g. `1f504_refresh`.
 * Case-insensitive — providers may deliver upper- or lower-case hex. Only the
 * single leading codepoint is parsed; multi-codepoint sequences (ZWJ, keycaps,
 * flags) resolve by their first codepoint and otherwise pass through unchanged,
 * which is fine while the table holds only single-codepoint emoji.
 */
const TEAMS_CODEPOINT = /^([0-9a-f]{4,6})_/i;

/** Resolve a Unicode token (as-is, then VS16-stripped) to a canonical name. */
const unicodeName = (token: string): KnownEmoji | undefined =>
  unicodeToName.get(token) ?? unicodeToName.get(stripVs16(token));

/** Platform-native token → canonical name, or `undefined` if unrecognized. */
export function normalizeEmoji(
  token: string,
  platform: EmojiPlatform,
): EmojiValue | undefined {
  if (platform === "slack") return slackToName.get(token);
  if (platform === "teams") {
    const exact = teamsToName.get(token);
    if (exact) return exact;
    // Modern Teams reactions: `<codepoint-hex>_<name>` — parse the leading hex
    // into its Unicode form, then look it up (bare or VS16-stripped).
    const hex = TEAMS_CODEPOINT.exec(token)?.[1];
    if (hex) {
      // The regex admits up to 6 hex digits (max 0xFFFFFF), but String.fromCodePoint
      // throws RangeError above U+10FFFF. rawEmoji is untrusted provider input, so
      // degrade an out-of-range token to passthrough (undefined) rather than throw
      // out of the reaction ingress path.
      const cp = parseInt(hex, 16);
      if (cp > 0x10ffff) return undefined;
      return unicodeName(String.fromCodePoint(cp));
    }
    // Classic Teams reactions arrive as bare names (`like`, `heart`, …).
    return teamsClassicToName[token];
  }
  // Discord/Telegram/WhatsApp: try the token as-is, then retry with VS16
  // stripped, since the platform may deliver/cache a bare codepoint without the
  // table's U+FE0F.
  return unicodeName(token);
}
