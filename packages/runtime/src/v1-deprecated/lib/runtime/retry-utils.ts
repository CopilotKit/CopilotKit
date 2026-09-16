import { Logger } from "pino";

// Retry configuration for network requests
export const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 5000,
  // HTTP status codes that should be retried
  retryableStatusCodes: [502, 503, 504, 408, 429],
  // Maximum Retry-After value (in seconds) we're willing to honor
  maxRetryAfterSeconds: 60,
  // Network error patterns that should be retried
  retryableErrorMessages: [
    "fetch failed",
    "network error",
    "connection timeout",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "ENOTFOUND",
    "ECONNRESET",
  ],
};

// Helper function to check if an error/response is retryable
export function isRetryableError(error: any, response?: Response): boolean {
  // Check HTTP response status
  if (response && RETRY_CONFIG.retryableStatusCodes.includes(response.status)) {
    return true;
  }

  // Check error codes (for connection errors like ECONNREFUSED)
  const errorCode = error?.cause?.code || error?.code;
  if (errorCode && RETRY_CONFIG.retryableErrorMessages.includes(errorCode)) {
    return true;
  }

  // Check error messages
  const errorMessage = error?.message?.toLowerCase() || "";
  return RETRY_CONFIG.retryableErrorMessages.some((msg) =>
    errorMessage.includes(msg),
  );
}

// Helper function to sleep for a given duration
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Parse the Retry-After header value into milliseconds.
// Returns undefined if the header is missing or unparseable.
export function parseRetryAfter(response: Response): number | undefined {
  const retryAfter = response.headers.get("Retry-After");
  if (!retryAfter) return undefined;

  // Try as seconds (integer)
  const seconds = Number(retryAfter);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  // Try as HTTP-date
  const date = Date.parse(retryAfter);
  if (!Number.isNaN(date)) {
    const delayMs = date - Date.now();
    return delayMs > 0 ? delayMs : 0;
  }

  return undefined;
}

// Calculate exponential backoff delay
export function calculateDelay(attempt: number): number {
  const delay = RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt);
  return Math.min(delay, RETRY_CONFIG.maxDelayMs);
}

// Retry wrapper for fetch requests
export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  logger?: Logger,
): Promise<Response> {
  let lastError: any;

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      // If response is retryable, treat as error and retry
      if (
        isRetryableError(null, response) &&
        attempt < RETRY_CONFIG.maxRetries
      ) {
        let delay = calculateDelay(attempt);

        // Honor Retry-After header on 429 responses
        if (response.status === 429) {
          const retryAfterMs = parseRetryAfter(response);
          if (retryAfterMs !== undefined) {
            const maxMs = RETRY_CONFIG.maxRetryAfterSeconds * 1000;
            if (retryAfterMs > maxMs) {
              throw new Error(
                `Server requested Retry-After of ${Math.ceil(retryAfterMs / 1000)}s ` +
                  `which exceeds the maximum of ${RETRY_CONFIG.maxRetryAfterSeconds}s`,
              );
            }
            delay = retryAfterMs;
          }
        }

        logger?.warn(
          `Request to ${url} failed with status ${response.status}. ` +
            `Retrying attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1} in ${delay}ms.`,
        );
        await sleep(delay);
        continue;
      }

      return response; // Success or non-retryable error
    } catch (error) {
      lastError = error;

      // Check if this is a retryable network error
      if (isRetryableError(error) && attempt < RETRY_CONFIG.maxRetries) {
        const delay = calculateDelay(attempt);
        logger?.warn(
          `Request to ${url} failed with network error. ` +
            `Retrying attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1} in ${delay}ms. Error: ${error?.message || String(error)}`,
        );
        await sleep(delay);
        continue;
      }

      // Not retryable or max retries exceeded
      break;
    }
  }

  // Re-throw the last error after retries exhausted
  throw lastError;
}
