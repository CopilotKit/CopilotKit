export type HeaderRecordInput = Record<string, string | null | undefined>;

/**
 * What `headers` accepts: a record, a sync builder, or an async builder. A
 * builder runs once per request, when the request is sent. See #1937.
 */
export type CopilotKitHeadersSource =
  | HeaderRecordInput
  | (() => HeaderRecordInput)
  | (() => Promise<HeaderRecordInput>);

export class CopilotKitHeaderResolutionError extends Error {
  override readonly name = "CopilotKitHeaderResolutionError";
  constructor(cause: unknown) {
    // Fixed message on purpose: never echo header values.
    super("[CopilotKit] Failed to resolve request headers", { cause });
  }
}

export function isHeaderResolutionError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (current instanceof CopilotKitHeaderResolutionError) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * Normalize a header map to a `Record<string, string>` with no `null` or
 * `undefined` values. Dropping an entry is how a header is cleared.
 */
export function normalizeHeaders(
  headers: HeaderRecordInput,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(
      (entry): entry is [string, string] => entry[1] != null,
    ),
  );
}

function isHeaderRecordInput(value: unknown): value is HeaderRecordInput {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Owns the headers source for one core. Resolution is synchronous for a
 * record or a sync builder, so those callers never pay an extra await.
 */
export class HeaderSourceResolver {
  private source: CopilotKitHeadersSource = {};
  private sourceGeneration = 0;
  private snapshot: Record<string, string> = {};
  private inFlight?: {
    generation: number;
    promise: Promise<Record<string, string>>;
  };

  constructor(
    private readonly onFailure: (
      error: CopilotKitHeaderResolutionError,
    ) => void,
  ) {}

  /** The last resolved headers. Not necessarily current for a builder. */
  get headers(): Record<string, string> {
    return this.snapshot;
  }

  /** Bumped on every accepted `setSource`, never by a new token. */
  get generation(): number {
    return this.sourceGeneration;
  }

  /** Returns false when a builder with the same identity is set again. */
  setSource(source: CopilotKitHeadersSource): boolean {
    if (typeof source === "function" && source === this.source) return false;
    this.source = source;
    this.sourceGeneration += 1;
    this.inFlight = undefined;
    // A builder hasn't run yet, so the previous source's snapshot must not
    // survive the switch — otherwise a stale value (e.g. the old user's
    // Authorization) would be re-applied to agents and broadcast as current.
    this.snapshot =
      typeof source === "function" ? {} : normalizeHeaders(source);
    return true;
  }

  resolve(): Record<string, string> | Promise<Record<string, string>> {
    const source = this.source;
    if (typeof source !== "function") return this.snapshot;
    const generation = this.sourceGeneration;
    if (this.inFlight?.generation === generation) return this.inFlight.promise;

    let value: HeaderRecordInput | Promise<HeaderRecordInput>;
    try {
      value = source();
    } catch (error) {
      throw this.fail(error);
    }
    if (!isPromiseLike(value)) return this.accept(value, generation);

    const promise: Promise<Record<string, string>> = Promise.resolve(value)
      .then(
        (resolved) => this.accept(resolved, generation),
        (error: unknown) => {
          throw this.fail(error);
        },
      )
      .finally(() => {
        if (this.inFlight?.promise === promise) this.inFlight = undefined;
      });
    this.inFlight = { generation, promise };
    return promise;
  }

  private accept(value: unknown, generation: number): Record<string, string> {
    if (!isHeaderRecordInput(value)) {
      throw this.fail(
        new TypeError("headers builder must return an object of header values"),
      );
    }
    const normalized = normalizeHeaders(value);
    if (generation === this.sourceGeneration) this.snapshot = normalized;
    return normalized;
  }

  private fail(cause: unknown): CopilotKitHeaderResolutionError {
    if (cause instanceof CopilotKitHeaderResolutionError) return cause;
    const error = new CopilotKitHeaderResolutionError(cause);
    this.onFailure(error);
    return error;
  }
}

/**
 * Add default headers (e.g. the public API key) to a source, only where the
 * source left the key unset or empty. The single shared replacement for the
 * React, Vue and Angular providers' own merges.
 */
export function ɵwithHeaderDefaults(
  source: CopilotKitHeadersSource,
  defaults: Record<string, string>,
): CopilotKitHeadersSource {
  if (Object.keys(defaults).length === 0) return source;
  const fill = (headers: HeaderRecordInput): HeaderRecordInput => {
    const out: HeaderRecordInput = { ...headers };
    for (const [key, value] of Object.entries(defaults)) {
      if (!out[key]) out[key] = value;
    }
    return out;
  };
  if (typeof source !== "function") return fill(source);
  // The wrapper's return type tracks its argument (sync stays sync, async
  // stays async), but that dependency isn't expressible in
  // `CopilotKitHeadersSource`'s shape, so the cast below stands in for it.
  return (() => {
    const value = source();
    return isPromiseLike(value)
      ? Promise.resolve(value).then((resolved) =>
          isHeaderRecordInput(resolved) ? fill(resolved) : resolved,
        )
      : isHeaderRecordInput(value)
        ? fill(value)
        : value;
  }) as CopilotKitHeadersSource;
}
