// Telemetry values use independent localStorage keys so a failed read or
// write cannot affect the inspector's persisted window state.
const TELEMETRY_DISTINCT_ID_KEY = "cpk:inspector:telemetry:distinct_id";
const TELEMETRY_OPT_OUT_KEY = "cpk:inspector:telemetry:opt_out";
const TELEMETRY_DISCLOSURE_SHOWN_KEY =
  "cpk:inspector:telemetry:disclosure_shown";

// Keep one session ID when storage is unavailable so related funnel events
// remain coherent without making telemetry a host-application dependency.
let inMemoryFallbackId: string | null = null;

export function getOrCreateTelemetryDistinctId(): string {
  if (typeof window === "undefined") return generateUuidV4();

  try {
    const existing = window.localStorage.getItem(TELEMETRY_DISTINCT_ID_KEY);
    if (existing && existing.length > 0) return existing;
    const fresh = generateUuidV4();
    window.localStorage.setItem(TELEMETRY_DISTINCT_ID_KEY, fresh);
    return fresh;
  } catch {
    return (inMemoryFallbackId ??= generateUuidV4());
  }
}

export function _resetTelemetryPersistenceForTesting(): void {
  inMemoryFallbackId = null;
}

export function isTelemetryOptedOut(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(TELEMETRY_OPT_OUT_KEY) === "true";
  } catch {
    return false;
  }
}

export function setTelemetryOptOut(optedOut: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (optedOut) {
      window.localStorage.setItem(TELEMETRY_OPT_OUT_KEY, "true");
    } else {
      window.localStorage.removeItem(TELEMETRY_OPT_OUT_KEY);
    }
  } catch {
    // Telemetry must never break the host when storage is unavailable.
  }
}

export function hasTelemetryDisclosureBeenShown(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.localStorage.getItem(TELEMETRY_DISCLOSURE_SHOWN_KEY) === "true"
    );
  } catch {
    return false;
  }
}

export function markTelemetryDisclosureShown(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TELEMETRY_DISCLOSURE_SHOWN_KEY, "true");
  } catch {
    // Telemetry must never break the host when storage is unavailable.
  }
}

function generateUuidV4(): string {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
