import type { PackedManifest } from "./channels-umbrella.js";

const DEFAULT_MAX_ATTEMPTS = 31;
const DEFAULT_RETRY_DELAY_MS = 10_000;

interface LoadPublishedChannelsManifestOptions {
  lookup: () => string;
  /** Whether the registry will serve this tarball right now. */
  headTarball?: (url: string) => Promise<boolean>;
  maxAttempts?: number;
  retryDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  onRetry?: (message: string) => void;
}

/** A published manifest, plus the tarball location the registry advertises for it. */
interface PublishedManifest extends PackedManifest {
  dist?: { tarball?: string };
}

/**
 * Whether the registry serves this tarball yet.
 *
 * A HEAD is enough: the umbrella's installer needs the bytes to exist, not their
 * contents, and the install itself is the real check that follows.
 */
async function headTarball(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
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
    headTarball: head = headTarball,
  }: LoadPublishedChannelsManifestOptions,
): Promise<PackedManifest> {
  const spec = `${name}@${version}`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const manifest = JSON.parse(lookup()) as PublishedManifest;

      // Metadata lands before the tarball is servable. `@copilotkit/channels` is
      // verified by installing it, so a manifest that parses is not yet evidence the
      // package can be installed: the v0.9.3 release passed this poll for all eight
      // adapters and then died on `ERR_PNPM_FETCH_404` fetching channels-slack's
      // tarball. Wait for the bytes, which is what the installer actually needs.
      const tarball = manifest.dist?.tarball;
      if (tarball !== undefined && !(await head(tarball))) {
        if (attempt === maxAttempts) {
          throw new Error(
            `registry has not served the tarball for ${spec} after ${maxAttempts} attempts; it is published but not yet installable`,
          );
        }

        onRetry(
          `${spec} is published but its tarball is not servable yet; retrying in ${retryDelayMs / 1000}s (${attempt}/${maxAttempts}).`,
        );
        await wait(retryDelayMs);
        continue;
      }

      return manifest;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("registry has not served the tarball")
      ) {
        throw error;
      }
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
