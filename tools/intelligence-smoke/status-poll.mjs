import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

const retryStatuses = new Set([408, 429, 500, 502, 503, 504]);
const retryCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);
/** Classify known temporary transport failures without retrying TLS or redirects. */
export function transientTransport(error) {
  return (
    error?.name === "TimeoutError" ||
    retryCodes.has(error?.code) ||
    retryCodes.has(error?.cause?.code)
  );
}
/** Poll only a run status GET, retaining the original absolute cleanup deadline. */
export async function pollRunStatus({
  id,
  deadline,
  request,
  now = Date.now,
  sleep = delay,
}) {
  let backoff = 1000;
  while (now() < deadline) {
    let wait = 10000;
    try {
      const response = await request(Math.min(30000, deadline - now()));
      if (retryStatuses.has(response.status)) {
        await response.body?.cancel();
        wait = backoff;
        backoff = Math.min(backoff * 2, 10000);
      } else {
        assert.ok(response.ok, `Runner HTTP ${response.status}`);
        const receipt = await response.json();
        assert.equal(receipt?.id, id, "Runner receipt identity changed");
        assert.ok(
          [
            "running",
            "passed",
            "failed",
            "cancelled",
            "interrupted-cleaned",
          ].includes(receipt.status),
          "Invalid runner receipt status",
        );
        if (receipt.status !== "running") return receipt;
        backoff = 1000;
      }
    } catch (error) {
      if (!transientTransport(error)) throw error;
      wait = backoff;
      backoff = Math.min(backoff * 2, 10000);
    }
    const remaining = deadline - now();
    if (remaining > 0) await sleep(Math.min(wait, remaining));
  }
  throw new Error("Runner still active; retained Railway journal owns cleanup");
}
