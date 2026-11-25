// The time zone a channel page's demo times are shown and booked in: the
// reader's own choice (kept in this browser), else the browser's zone, else
// Pacific, the hosts' own. Every label is en-US, like the rest of the docs.

export const FALLBACK_TIME_ZONE = "America/Los_Angeles";

const STORAGE_KEY = "cpk-channel-demo-time-zone";

/**
 * The zones the picker offers, west to east, with a short name each, by
 * their `canonicalTimeZone` ids.
 */
const COMMON_TIME_ZONES: { zone: string; name: string }[] = [
  { zone: "America/Los_Angeles", name: "Pacific" },
  { zone: "America/Denver", name: "Mountain" },
  { zone: "America/Chicago", name: "Central" },
  { zone: "America/New_York", name: "Eastern" },
  { zone: "America/Sao_Paulo", name: "São Paulo" },
  { zone: "UTC", name: "UTC" },
  { zone: "Europe/London", name: "London" },
  { zone: "Europe/Berlin", name: "Central Europe" },
  { zone: "Asia/Kolkata", name: "India" },
  { zone: "Asia/Singapore", name: "Singapore" },
  { zone: "Asia/Tokyo", name: "Tokyo" },
  { zone: "Australia/Sydney", name: "Sydney" },
];

/**
 * The list's names for zones that Chromium and Safari call by an older one
 * (they report India as Asia/Calcutta).
 */
const CURRENT_NAMES: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
};

const canonicalIds = new Map<string, string>();

/**
 * One id per zone, so two names for it compare equal: Intl's own id for it
 * (`resolvedOptions().timeZone`), or the list's name where that is newer.
 * An id Intl doesn't know comes back as it is.
 */
export function canonicalTimeZone(zone: string): string {
  let id = canonicalIds.get(zone);
  if (id === undefined) {
    try {
      id = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
      }).resolvedOptions().timeZone;
    } catch {
      id = zone;
    }
    id = CURRENT_NAMES[id] ?? id;
    if (canonicalIds.size < 500) canonicalIds.set(zone, id);
  }
  return id;
}

/** Intl must accept it ("Etc/Unknown" throws), as the website checks. */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 64) {
    return false;
  }
  try {
    return !!new Intl.DateTimeFormat("en-US", { timeZone: value });
  } catch {
    return false;
  }
}

function zoneNamePart(
  zone: string,
  at: number,
  style: "short" | "longOffset",
): string {
  return (
    new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: style })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value ?? ""
  );
}

/** A zone's offset from UTC at a moment, in minutes. */
export function offsetMinutes(zone: string, at: number): number {
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(
    zoneNamePart(zone, at, "longOffset"),
  );
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "-" ? -minutes : minutes;
}

/**
 * "Pacific (PST)", "Central Europe (GMT+1)", or a city for other zones, with
 * the zone's abbreviation at `at` (it changes with daylight saving time).
 */
export function zoneLabel(zone: string, at = Date.now()): string {
  const id = canonicalTimeZone(zone);
  const name =
    COMMON_TIME_ZONES.find((option) => option.zone === id)?.name ??
    (id.split("/").pop() ?? id).replace(/_/g, " ");
  const short = zoneNamePart(id, at, "short");
  return short && short !== name ? `${name} (${short})` : name;
}

/**
 * The picker's zones, by their canonical ids: the common ones, led by the
 * current one when it isn't among them.
 */
export function timeZoneOptions(current: string, at = Date.now()) {
  const common = COMMON_TIME_ZONES.map((option) => option.zone);
  const id = canonicalTimeZone(current);
  const zones = common.includes(id) ? common : [id, ...common];
  return zones.map((zone) => ({ zone, label: zoneLabel(zone, at) }));
}

/**
 * The zone to start in, by its canonical id: the stored choice, the
 * browser's, else Pacific.
 */
export function initialTimeZone(): string {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be blocked; the browser's zone still applies.
  }
  if (isValidTimeZone(stored)) return canonicalTimeZone(stored);
  try {
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (isValidTimeZone(browser)) return canonicalTimeZone(browser);
  } catch {
    // Fall through to the hosts' zone.
  }
  return FALLBACK_TIME_ZONE;
}

/** Keeps the reader's choice for their next visit, where storage allows. */
export function storeTimeZone(zone: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, zone);
  } catch {
    // A convenience: without storage the choice lasts the visit.
  }
}
