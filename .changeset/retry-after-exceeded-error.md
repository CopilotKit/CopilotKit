---
"@copilotkit/runtime": patch
---

Surface 429 quota exhaustion as a typed `RetryAfterExceededError`

When a 429 response carries a `Retry-After` value that exceeds
`RETRY_CONFIG.maxRetryAfterSeconds` (60s by default), `fetchWithRetry` now
throws a `RetryAfterExceededError` instead of a generic `Error`. The new
class carries the parsed `retryAfterMs` and the original `response`, so
callers can discriminate the rate-limit-quota-exhausted condition from
ordinary fetch failures and decide whether to wait the full reset window
or abort.

Existing call sites that only catch the throw continue to work — the
new class still extends `Error` and the message is unchanged.
