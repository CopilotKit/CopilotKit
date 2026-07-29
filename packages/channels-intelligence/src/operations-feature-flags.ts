const OPERATIONS_POSTHOG_FLAGS_URL = "https://eu.i.posthog.com/flags/?v=2";
const OPERATIONS_POSTHOG_PROJECT_TOKEN =
  "phc_XZdymVYjrph9Mi0xZYGNyCKexxgblXRR1jMENCtdz5Q";
const CHANNELS_TERMINAL_BATCHING_FLAG = "channels-terminal-batching";
const OPERATIONS_POSTHOG_REQUEST_TIMEOUT_MS = 3_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function isChannelsTerminalBatchingEnabled(
  projectId: number,
  fetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    OPERATIONS_POSTHOG_REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(OPERATIONS_POSTHOG_FLAGS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        token: OPERATIONS_POSTHOG_PROJECT_TOKEN,
        distinct_id: `intelligence-project:${projectId}`,
        geoip_disable: true,
      }),
    });
    if (!response.ok) {
      return false;
    }

    const body: unknown = await response.json();
    if (!isRecord(body) || !isRecord(body.flags)) {
      return false;
    }

    const flag = body.flags[CHANNELS_TERMINAL_BATCHING_FLAG];
    return isRecord(flag) && flag.enabled === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
