/**
 * Memory error registry — stable codes for the errors the memory store throws.
 *
 * The memory store (`memory.ts`) used to throw bare `new Error("Failed to fetch
 * memories: 500")` / `"Request timed out"` / `"Request failed: <status>"`. Those
 * reach the `error` selector (and the consumer UI via `useMemories` /
 * `injectMemories`) verbatim, with no machine-readable `code`/`category`/
 * `retryable`, so they cannot be grouped in observability or branched on by
 * consumers.
 *
 * Per the repo's error-handling architecture standard (AGENTS.md: "Each project
 * must maintain an explicit error registry"), this file is the explicit registry
 * for the memory feature. It is deliberately scoped to memory — not a repo-wide
 * registry refactor — because `packages/core` has no pre-existing
 * code/category/retryable registry convention to plug into (the runtime's
 * `lib/error-messages.ts` is a message-templating table, not a typed
 * code/category/retryable registry). It mirrors the existing
 * `AgentThreadLockedError extends Error` precedent in
 * `intelligence-agent.ts`: a real `Error` subclass so `instanceof Error` holds
 * and the public `MemoryState.error: Error | null` contract is preserved.
 *
 * `docsPath` is recorded per entry per the standard; there is no
 * `docs/errors/<project>.md` in this repo, so this docblock plus the registry
 * are the source of truth.
 *
 * Each registry entry carries:
 * - `code`: stable identifier (e.g. `MEMORY_LIST_FAILED`).
 * - `category`: one of the standard categories
 *   (`validation`|`auth`|`permission`|`not_found`|`conflict`|`rate_limit`|`internal`|`dependency`).
 * - `retryable`: whether a retry could plausibly succeed (timeouts + transient
 *   dependency failures are retryable; client-caused 4xx are not).
 * - `message`: the default human-readable message (callers may override with a
 *   status-bearing string to preserve the prior wording).
 * - `docsPath`: documentation pointer for the code.
 */

/** Standard error categories from the repo error-handling architecture. */
export type MemoryErrorCategory =
  | "validation"
  | "auth"
  | "permission"
  | "not_found"
  | "conflict"
  | "rate_limit"
  | "internal"
  | "dependency";

/** Stable codes for the memory store's surfaced errors. */
export type MemoryErrorCode =
  | "MEMORY_LIST_FAILED"
  | "MEMORY_CREDENTIALS_FAILED"
  | "MEMORY_MUTATION_FAILED"
  | "MEMORY_REQUEST_TIMEOUT";

/** A single registry entry describing one memory error code. */
export interface MemoryErrorRegistryEntry {
  readonly code: MemoryErrorCode;
  readonly category: MemoryErrorCategory;
  readonly retryable: boolean;
  readonly message: string;
  readonly docsPath: string;
}

/**
 * The memory error registry: the single source of truth for memory error
 * metadata. Keyed by `code` so a code maps to exactly one category/retryable
 * default.
 *
 * Categories/retryable rationale:
 * - List/credentials/mutation failures are `dependency` (the runtime/platform
 *   the store calls failed). A 5xx is transient (`retryable: true`); a 4xx is
 *   caller-caused, so the helpers below downgrade those to non-retryable.
 * - Timeouts are `dependency` and `retryable: true` (the request may simply be
 *   slow).
 */
export const MEMORY_ERROR_REGISTRY: Readonly<
  Record<MemoryErrorCode, MemoryErrorRegistryEntry>
> = Object.freeze({
  MEMORY_LIST_FAILED: {
    code: "MEMORY_LIST_FAILED",
    category: "dependency",
    retryable: true,
    message: "Failed to fetch memories",
    docsPath: "docs/errors/memory.md#memory_list_failed",
  },
  MEMORY_CREDENTIALS_FAILED: {
    code: "MEMORY_CREDENTIALS_FAILED",
    category: "dependency",
    retryable: true,
    message: "Failed to fetch memory subscribe credentials",
    docsPath: "docs/errors/memory.md#memory_credentials_failed",
  },
  MEMORY_MUTATION_FAILED: {
    code: "MEMORY_MUTATION_FAILED",
    category: "dependency",
    retryable: true,
    message: "Memory mutation request failed",
    docsPath: "docs/errors/memory.md#memory_mutation_failed",
  },
  MEMORY_REQUEST_TIMEOUT: {
    code: "MEMORY_REQUEST_TIMEOUT",
    category: "dependency",
    retryable: true,
    message: "Request timed out",
    docsPath: "docs/errors/memory.md#memory_request_timeout",
  },
});

/**
 * An `Error` carrying a stable memory error `code`, `category`, and `retryable`
 * flag so consumers and observability can branch on it without string-matching
 * the message.
 *
 * It is a real `Error` subclass: `instanceof Error` is true, so the public
 * `MemoryState.error: Error | null` contract (and the `error: Error | null`
 * surfaced by `useMemories` / `injectMemories`) holds unchanged. Existing
 * consumers that only read `.message` keep working; the richer fields are
 * additive.
 */
export class MemoryError extends Error {
  /** Stable, machine-readable error identifier. */
  readonly code: MemoryErrorCode;
  /** Coarse error category for grouping/observability. */
  readonly category: MemoryErrorCategory;
  /** Whether retrying the operation could plausibly succeed. */
  readonly retryable: boolean;

  /**
   * @param code - Registry code identifying this error.
   * @param options - Optional overrides:
   *   - `message`: human-readable message (defaults to the registry message;
   *     callers pass a status-bearing string to preserve prior wording).
   *   - `retryable`: overrides the registry default (e.g. a 4xx list failure is
   *     not retryable even though the code's default is).
   *   - `cause`: the underlying error, preserved for debugging.
   */
  constructor(
    code: MemoryErrorCode,
    options?: { message?: string; retryable?: boolean; cause?: unknown },
  ) {
    const entry = MEMORY_ERROR_REGISTRY[code];
    super(options?.message ?? entry.message, { cause: options?.cause });
    this.name = "MemoryError";
    this.code = code;
    this.category = entry.category;
    this.retryable = options?.retryable ?? entry.retryable;
    // Restore the prototype chain for environments that downlevel `extends`
    // (matches the pattern the SDK relies on for cross-target `instanceof`).
    Object.setPrototypeOf(this, MemoryError.prototype);
  }
}

/**
 * Narrows an HTTP status to whether the failure is worth retrying: a 5xx (or a
 * missing/0 status) is a transient dependency failure and retryable; a 4xx is
 * caller-caused and not. Used so a `MEMORY_LIST_FAILED`/`MEMORY_MUTATION_FAILED`
 * carries an accurate `retryable` flag derived from the response status.
 */
export function isRetryableStatus(status: number): boolean {
  return !(Number.isInteger(status) && status >= 400 && status <= 499);
}
