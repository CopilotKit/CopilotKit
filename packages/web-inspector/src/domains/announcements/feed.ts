import { renderAnnouncementDocument } from "./document.js";

export const ANNOUNCEMENT_FEED_URL =
  "https://cdn.copilotkit.ai/announcements.json";

const ANNOUNCEMENT_READ_COOKIE_NAME = "cpk_inspector_announcements";
const ANNOUNCEMENT_READ_MIRROR_KEY = "cpk:inspector:announcement_read";
const LEGACY_ANNOUNCEMENT_READ_KEY = "cpk:inspector:announcements";
const ANNOUNCEMENT_PULSED_SESSION_KEY = "cpk:inspector:pulsed";
const ANNOUNCEMENT_READ_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type AnnouncementReady = Readonly<{
  status: "ready";
  timestamp: string;
  markdown: string;
  documentHtml: string;
  preview: Readonly<{
    title: string;
    text: string;
  }>;
  ctaLabel?: string;
  shouldArm: boolean;
  shouldPulse: boolean;
}>;

export type AnnouncementFeedProjection =
  | AnnouncementReady
  | Readonly<{ status: "invalid" }>;

export type AnnouncementFeedLoadResult =
  | AnnouncementFeedProjection
  | Readonly<{ status: "failed" }>;

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function stringProperty(value: object, key: string): string | undefined {
  const property = Reflect.get(value, key);
  return typeof property === "string" ? property : undefined;
}

export function announcementPreview(markdown: string, maxLength = 140): string {
  const plain = markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length <= maxLength
    ? plain
    : `${plain.slice(0, maxLength).trimEnd()}…`;
}

export function projectAnnouncementFeed(
  value: unknown,
): AnnouncementFeedProjection {
  if (!isObject(value)) return { status: "invalid" };

  const timestamp = stringProperty(value, "timestamp");
  const markdown = stringProperty(value, "announcement");
  if (!timestamp || !markdown) return { status: "invalid" };

  const previewText = stringProperty(value, "previewText");
  const ctaLabel = stringProperty(value, "cta_label");
  const documentHtml = renderAnnouncementDocument(markdown);
  const heading = markdown.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
  const ready: AnnouncementReady = {
    status: "ready",
    timestamp,
    markdown,
    documentHtml,
    preview: {
      title: heading || "The latest from CopilotKit",
      text: previewText?.trim() || announcementPreview(markdown, 160),
    },
    ...(ctaLabel === undefined ? {} : { ctaLabel }),
    shouldArm:
      documentHtml.length > 0 && loadAnnouncementReadTimestamp() !== timestamp,
    shouldPulse: loadAnnouncementPulsedTimestamp() !== timestamp,
  };
  return ready;
}

export async function loadAnnouncementFeed(
  fetcher: typeof fetch = fetch,
): Promise<AnnouncementFeedLoadResult> {
  try {
    const response = await fetcher(ANNOUNCEMENT_FEED_URL, {
      cache: "no-cache",
    });
    if (!response.ok) {
      throw new Error(`Failed to load announcement (${response.status})`);
    }
    const projection = projectAnnouncementFeed(await response.json());
    if (projection.status === "invalid") {
      throw new Error("Malformed announcement payload");
    }
    return projection;
  } catch (error) {
    console.warn("[CopilotKit Inspector] Failed to load announcement", error);
    return { status: "failed" };
  }
}

export function loadAnnouncementReadTimestamp(): string | null {
  return (
    parseTimestampPayload(readAnnouncementCookie()) ??
    parseTimestampPayload(readLocalStorageItem(ANNOUNCEMENT_READ_MIRROR_KEY))
  );
}

export function saveAnnouncementReadTimestamp(timestamp: string): void {
  const payload = JSON.stringify({ timestamp });
  writeAnnouncementCookie(payload);
  writeLocalStorageItem(ANNOUNCEMENT_READ_MIRROR_KEY, payload);
}

export function clearLegacyAnnouncementReadState(): void {
  removeLocalStorageItem(LEGACY_ANNOUNCEMENT_READ_KEY);
}

export function loadAnnouncementPulsedTimestamp(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(ANNOUNCEMENT_PULSED_SESSION_KEY);
  } catch {
    return null;
  }
}

export function saveAnnouncementPulsedTimestamp(timestamp: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(ANNOUNCEMENT_PULSED_SESSION_KEY, timestamp);
  } catch {
    // A lost suppression costs one extra pulse, never correctness.
  }
}

function parseTimestampPayload(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) return null;
    return stringProperty(parsed, "timestamp") ?? null;
  } catch {
    return null;
  }
}

function readAnnouncementCookie(): string | null {
  if (typeof document === "undefined") return null;
  try {
    for (const entry of document.cookie.split(";")) {
      const separator = entry.indexOf("=");
      if (separator === -1) continue;
      if (entry.slice(0, separator).trim() !== ANNOUNCEMENT_READ_COOKIE_NAME) {
        continue;
      }
      return decodeURIComponent(entry.slice(separator + 1).trim());
    }
  } catch {
    // Sandboxed documents can deny cookie access.
  }
  return null;
}

function writeAnnouncementCookie(value: string): void {
  if (typeof document === "undefined") return;
  try {
    document.cookie = `${ANNOUNCEMENT_READ_COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; Max-Age=${ANNOUNCEMENT_READ_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
  } catch {
    // The localStorage mirror remains available when cookies are blocked.
  }
}

function readLocalStorageItem(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorageItem(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Persistence failure must not affect the host application.
  }
}

function removeLocalStorageItem(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Persistence failure must not affect the host application.
  }
}
