/**
 * The person using the demo, identified by the name they type once.
 *
 * The name becomes a stable id ("Ada Lovelace" -> "ada-lovelace") that the
 * runtime passes to CopilotKit Intelligence in `identifyUser`, so threads and
 * Product Analytics are per person, and the same name on another device opens
 * the same threads. It is not authentication: anyone who types the same name
 * gets the same threads. Replace it with your own session before going public.
 */

export const USER_ID_COOKIE = "rd_user";
export const USER_NAME_COOKIE = "rd_user_name";
const STORAGE_KEY = "repo-doctor-user";
const ONE_YEAR = 60 * 60 * 24 * 365;
const MAX_NAME = 40;

export interface DemoUser {
  id: string;
  name: string;
}

export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_NAME);
}

export function isUserId(value: string | undefined): value is string {
  return Boolean(value && /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(value));
}

/** Reads the user from a Cookie header (server) or document.cookie (browser). */
export function userFromCookieHeader(
  header: string | null | undefined,
): DemoUser | null {
  if (!header) return null;
  const cookies = new Map(
    header.split(";").map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key ?? "", rest.join("=")] as const;
    }),
  );
  const id = cookies.get(USER_ID_COOKIE);
  if (!isUserId(id)) return null;
  let name = id;
  try {
    name =
      decodeURIComponent(cookies.get(USER_NAME_COOKIE) ?? id).slice(
        0,
        MAX_NAME,
      ) || id;
  } catch {
    // A malformed name cookie falls back to the id.
  }
  return { id, name };
}

/** Saves the user in a cookie (read by the runtime on every request) and localStorage. */
export function saveUser(name: string): DemoUser | null {
  const trimmed = name.trim().slice(0, MAX_NAME);
  const id = slugify(trimmed);
  if (!isUserId(id)) return null;
  const attributes = `path=/; max-age=${ONE_YEAR}; samesite=lax`;
  document.cookie = `${USER_ID_COOKIE}=${id}; ${attributes}`;
  document.cookie = `${USER_NAME_COOKIE}=${encodeURIComponent(trimmed)}; ${attributes}`;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ id, name: trimmed }));
  } catch {
    // Storage blocked: the cookie alone is enough.
  }
  return { id, name: trimmed };
}

/** The name saved in localStorage, used to prefill the prompt if the cookie was cleared. */
export function storedName(): string {
  try {
    const stored = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "null",
    ) as unknown;
    return stored &&
      typeof stored === "object" &&
      "name" in stored &&
      typeof stored.name === "string"
      ? stored.name
      : "";
  } catch {
    return "";
  }
}
