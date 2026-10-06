/*
 * The two pieces of Intelligence apps/app-frontend/react-shell/src/api-client.ts
 * (main @ b71006350) the copied Learning components use: the client type and
 * its error class. There is no hosted client here; `ledgerline-learning-api.ts`
 * talks to /api/learning/v1 directly.
 */
export interface HostedApiClient {
  readonly getJson: <T>(path: string, options?: { readonly signal?: AbortSignal }) => Promise<T>;
}

export class ApiClientError extends Error {
  readonly category: string | null;
  readonly code: string | null;
  readonly requestId: string | null;
  readonly retryable: boolean | null;
  readonly status: number;
  readonly traceId: string | null;

  constructor(input: {
    readonly category?: string | null;
    readonly code?: string | null;
    readonly message: string;
    readonly requestId?: string | null;
    readonly retryable?: boolean | null;
    readonly status: number;
    readonly traceId?: string | null;
  }) {
    super(input.message);
    this.name = 'ApiClientError';
    this.category = input.category ?? null;
    this.code = input.code ?? null;
    this.requestId = input.requestId ?? null;
    this.retryable = input.retryable ?? null;
    this.status = input.status;
    this.traceId = input.traceId ?? null;
  }
}
