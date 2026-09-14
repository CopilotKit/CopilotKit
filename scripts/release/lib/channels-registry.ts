import type { PackedManifest } from "./channels-umbrella.js";

const DEFAULT_MAX_ATTEMPTS = 31;
const DEFAULT_RETRY_DELAY_MS = 10_000;

interface LoadPublishedChannelsManifestOptions {
  lookup: () => string;
  maxAttempts?: number;
  retryDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  onRetry?: (message: string) => void;
}

function isRegistryMissing(error: unknown): boolean {
  const stderr =
    typeof error === "object" && error !== null && "stderr" in error
      ? String(error.stderr)
      : "";
  return stderr.includes("E404");
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function loadPublishedChannelsManifest(
  name: string,
  version: string,
  {
    lookup,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    sleep: wait = sleep,
    onRetry = console.warn,
  }: LoadPublishedChannelsManifestOptions,
): Promise<PackedManifest> {
  const spec = `${name}@${version}`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return JSON.parse(lookup()) as PackedManifest;
    } catch (error) {
      if (!isRegistryMissing(error)) throw error;
      if (attempt === maxAttempts) {
        throw new Error(
          `registry is missing ${spec} after ${maxAttempts} attempts; publish channels-core and every adapter before publishing @copilotkit/channels`,
          { cause: error },
        );
      }

      onRetry(
        `${spec} is not visible on npm yet; retrying in ${retryDelayMs / 1000}s (${attempt}/${maxAttempts}).`,
      );
      await wait(retryDelayMs);
    }
  }

  throw new Error(`unreachable registry lookup state for ${spec}`);
}
