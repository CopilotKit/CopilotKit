export const LEARNING_SETUP_STORAGE_KEY = "cpk:inspector:learning-setup:v1";
export const LEARNING_SETUP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

export interface LearningSetupMarker {
  readonly version: 1;
  readonly runtimeUrl: string;
  readonly agentId: string | null;
  readonly startedAt: string;
}

let inMemoryMarker: LearningSetupMarker | null = null;

export function normalizeLearningRuntimeUrl(
  runtimeUrl: string,
  baseUri?: string,
): string | null {
  try {
    const browserBaseUri =
      baseUri ??
      (typeof document === "undefined" ? undefined : document.baseURI);
    const url = browserBaseUri
      ? new URL(runtimeUrl, browserBaseUri)
      : new URL(runtimeUrl);
    url.search = "";
    url.hash = "";
    url.pathname =
      url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/u, "");
    return url.toString();
  } catch {
    return null;
  }
}

function parseMarker(
  raw: string | null,
  now: number,
): LearningSetupMarker | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<LearningSetupMarker>;
    const started =
      typeof value.startedAt === "string" ? Date.parse(value.startedAt) : NaN;
    if (
      value.version !== 1 ||
      typeof value.runtimeUrl !== "string" ||
      (value.agentId !== null && typeof value.agentId !== "string") ||
      !Number.isFinite(started) ||
      started > now ||
      now - started > LEARNING_SETUP_MAX_AGE_MS
    ) {
      return null;
    }
    return value as LearningSetupMarker;
  } catch {
    return null;
  }
}

export function readLearningSetupMarker(
  now = Date.now(),
): LearningSetupMarker | null {
  try {
    const raw = localStorage.getItem(LEARNING_SETUP_STORAGE_KEY);
    const persisted = parseMarker(raw, now);
    if (persisted) return persisted;
    if (raw !== null) localStorage.removeItem(LEARNING_SETUP_STORAGE_KEY);
  } catch {
    // The page-local fallback below preserves the interaction.
  }
  return parseMarker(
    inMemoryMarker ? JSON.stringify(inMemoryMarker) : null,
    now,
  );
}

export function writeLearningSetupMarker(input: {
  readonly runtimeUrl: string;
  readonly agentId: string | null;
  readonly now?: Date;
}): LearningSetupMarker {
  const runtimeUrl = normalizeLearningRuntimeUrl(input.runtimeUrl);
  if (!runtimeUrl) throw new Error("Runtime URL is unavailable.");
  const marker: LearningSetupMarker = {
    version: 1,
    runtimeUrl,
    agentId: input.agentId,
    startedAt: (input.now ?? new Date()).toISOString(),
  };
  inMemoryMarker = marker;
  try {
    localStorage.setItem(LEARNING_SETUP_STORAGE_KEY, JSON.stringify(marker));
  } catch {
    // Storage is optional; retain the marker in memory.
  }
  return marker;
}

export function clearLearningSetupMarker(): void {
  inMemoryMarker = null;
  try {
    localStorage.removeItem(LEARNING_SETUP_STORAGE_KEY);
  } catch {
    // Best effort only.
  }
}

export function learningSetupMarkerMatches(
  marker: LearningSetupMarker | null,
  runtimeUrl: string,
  agentId: string | null,
): boolean {
  return (
    marker !== null &&
    marker.runtimeUrl === normalizeLearningRuntimeUrl(runtimeUrl) &&
    marker.agentId === agentId
  );
}

/** Keeps multiple Inspector instances on the same origin in sync. */
export function subscribeToLearningSetupMarker(
  listener: (marker: LearningSetupMarker | null) => void,
): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === LEARNING_SETUP_STORAGE_KEY) {
      const marker = parseMarker(event.newValue, Date.now());
      if (event.newValue !== null && marker === null) {
        try {
          localStorage.removeItem(LEARNING_SETUP_STORAGE_KEY);
        } catch {
          // Storage is optional; still notify the listener below.
        }
      }
      listener(marker);
    }
  };
  window.addEventListener("storage", handleStorage);
  return () => window.removeEventListener("storage", handleStorage);
}

export const _test = {
  resetMemory: () => {
    inMemoryMarker = null;
  },
};
