import type {
  Logger,
  RenderedMessage,
  Target,
  TargetConfig,
} from "../types/index.js";

export interface SlackWebhookOptions {
  logger: Logger;
  env?: Readonly<Record<string, string | undefined>>;
  fetchImpl?: typeof fetch;
  /**
   * Total number of attempts before giving up. `maxRetries = 3` means up
   * to 3 *attempts* (NOT 1 + 3). Named for backwards compatibility with
   * earlier callers; consider reading as "max attempts".
   */
  maxRetries?: number;
  /** Override the backoff sleep; useful for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Cap exponential backoff so a long-running upstream outage doesn't stall
 * the alert pipeline for minutes at a time. 30s matches the cap applied
 * to Retry-After parsing below.
 */
const MAX_BACKOFF_MS = 30_000;

function exponentialBackoffMs(attempt: number): number {
  return Math.min(2 ** attempt * 100, MAX_BACKOFF_MS);
}

/**
 * Parse an RFC 7231 `Retry-After` seconds value. Date form is NOT
 * supported — Slack's incoming webhooks always return seconds, and a
 * date-form value from a misbehaving proxy would otherwise parse as NaN
 * and fall through to exponential backoff (acceptable).
 */
function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(Math.floor(seconds * 1000), MAX_BACKOFF_MS);
}

export function createSlackWebhookTarget(opts: SlackWebhookOptions): Target {
  const env = opts.env ?? process.env;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const maxAttempts = opts.maxRetries ?? 3;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  function resolveWebhook(alias: string | undefined): string | undefined {
    if (!alias) return undefined;
    const varName = `SLACK_WEBHOOK_${alias.toUpperCase()}`;
    return env[varName];
  }

  return {
    kind: "slack_webhook",
    /**
     * Delivery contract (consumed by alert-engine):
     *   - Successful delivery: resolves with `void`.
     *   - Missing webhook env var: resolves with `void` (deliberate
     *     no-op; not a failure — alert is simply suppressed).
     *   - Any other failure (network exhausted, 4xx, 429-exhausted,
     *     5xx-exhausted): throws. The engine's `deliverToTargets`
     *     uses these throws to decide whether to record dedupe state
     *     — success implies at-least-one delivery, throw implies none.
     */
    async send(rendered: RenderedMessage, config: TargetConfig): Promise<void> {
      const webhookUrl = resolveWebhook(config.webhook);
      if (!webhookUrl) {
        opts.logger.warn("slack-webhook.skip", {
          reason: "webhook-env-unset",
          webhook: config.webhook,
        });
        return;
      }

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        let res: Response;
        try {
          res = await fetchImpl(webhookUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(rendered.payload),
          });
        } catch (err) {
          // Network-level failures (TypeError: fetch failed, AbortError,
          // DNS fail) are transient — treat them exactly like a 5xx.
          opts.logger.warn("slack-webhook.network-error", {
            attempt,
            err: String(err),
          });
          if (attempt < maxAttempts) {
            await sleep(exponentialBackoffMs(attempt));
            continue;
          }
          opts.logger.error("slack-webhook.network-exhausted", {
            attempts: attempt,
            err: String(err),
          });
          // Throw so the alert engine records target-failed (not a
          // silent no-op that looks like a successful send).
          throw err;
        }

        if (res.ok) return;

        if (res.status === 429) {
          // Respect Retry-After when present; otherwise fall back to
          // the same exponential backoff we use for 5xx.
          const retryAfterMs =
            parseRetryAfterMs(res.headers.get("retry-after")) ??
            exponentialBackoffMs(attempt);
          opts.logger.warn("slack-webhook.rate-limited", {
            attempt,
            retryAfterMs,
          });
          if (attempt < maxAttempts) {
            await sleep(retryAfterMs);
            continue;
          }
          opts.logger.error("slack-webhook.429-exhausted", {
            attempts: attempt,
          });
          throw new Error(
            `slack-webhook rate-limited (429) after ${attempt} attempts`,
          );
        }

        if (res.status >= 400 && res.status < 500) {
          // 404/403/other 4xx = permanent. Log and throw so the engine
          // records a target-failed outcome and does not mark the alert
          // as delivered.
          const text = await res.text().catch(() => "");
          opts.logger.warn("slack-webhook.4xx", {
            status: res.status,
            body: text.length > 200 ? text.slice(0, 200) + "…" : text,
          });
          throw new Error(
            `slack-webhook rejected with ${res.status} (non-retryable)`,
          );
        }

        // 5xx: retry with bounded exponential backoff (cap 30s).
        if (attempt < maxAttempts) {
          await sleep(exponentialBackoffMs(attempt));
          continue;
        }
        opts.logger.error("slack-webhook.5xx-exhausted", {
          status: res.status,
          attempts: attempt,
        });
        // Throw so the alert engine sees target-failed and we don't
        // update dedupe state as if the alert was delivered.
        throw new Error(
          `slack-webhook failed with ${res.status} after ${attempt} attempts`,
        );
      }
    },
  };
}
