import type { Logger } from "../../types/index.js";

const THREADS_CLEAR_PATH = "/api/copilotkit-voice/threads/clear";
const THREADS_CLEAR_TIMEOUT_MS = 5_000;
const THREADS_CLEAR_WARN_KEY = "probe.e2e.threads-clear-failed";

function warnClearFailure(logger: Logger, meta: Record<string, unknown>): void {
  try {
    logger.warn(THREADS_CLEAR_WARN_KEY, meta);
  } catch {
    // Thread cleanup is strictly best-effort; even a broken logging sink must
    // not change the probe result returned by the driver.
  }
}

/**
 * Clear a showcase service's process-wide InMemoryAgentRunner thread store.
 * Probes mint a fresh thread id on every run, while the default runner keeps
 * every thread indefinitely, so omitting this cleanup leaks heap over time.
 *
 * The copilotkit-voice catch-all is intentional: it is the ungated route that
 * accepts `/threads/clear`. Other copilotkit routes match only their exact
 * path, and the auth catch-all requires credentials. Because the store is
 * module-scoped, this one request clears threads created through every route
 * on the service.
 *
 * Cleanup is never load-bearing. Network, timeout, HTTP, and logging failures
 * are swallowed so they cannot turn a green probe red or alter its result.
 */
export async function clearRemoteThreads(
  backendUrl: string,
  slug: string,
  logger: Logger,
): Promise<void> {
  try {
    const response = await fetch(`${backendUrl}${THREADS_CLEAR_PATH}`, {
      method: "POST",
      signal: AbortSignal.timeout(THREADS_CLEAR_TIMEOUT_MS),
    });

    if (!response.ok) {
      warnClearFailure(logger, {
        slug,
        status: response.status,
        err: `http ${response.status}`,
      });
    }
  } catch (err) {
    warnClearFailure(logger, {
      slug,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
