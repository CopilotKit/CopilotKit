/** Stable failure codes shared by learned-skill delivery and its consumers. */
export type LearnedSkillsErrorCode =
  | "INVALID_CONFIG"
  | "AUTHENTICATION_FAILED"
  | "AUTHORIZATION_FAILED"
  | "ENTITLEMENT_REQUIRED"
  | "DELIVERY_DISABLED"
  | "CONTAINER_NOT_FOUND"
  | "REVISION_NOT_FOUND"
  | "REVISION_REVOKED"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "INVALID_SNAPSHOT"
  | "UNSUPPORTED_SERVER";

const messages: Record<LearnedSkillsErrorCode, string> = {
  INVALID_CONFIG: "Invalid learned-skills request configuration.",
  AUTHENTICATION_FAILED: "Learned-skills authentication failed.",
  AUTHORIZATION_FAILED: "Learned-skills access was denied.",
  ENTITLEMENT_REQUIRED: "Learned-skills delivery requires an entitlement.",
  DELIVERY_DISABLED: "Learned-skills delivery is disabled.",
  CONTAINER_NOT_FOUND: "The learning container was not found.",
  REVISION_NOT_FOUND: "The learned-skills revision was not found.",
  REVISION_REVOKED: "The learned-skills revision was revoked.",
  NETWORK_ERROR: "The learned-skills request failed during transport.",
  TIMEOUT: "The learned-skills request timed out.",
  INVALID_SNAPSHOT: "The learned-skills response metadata is invalid.",
  UNSUPPORTED_SERVER:
    "The server returned an unsupported learned-skills response.",
};

/** Safe message and stable code; server response bodies are never retained. */
export class LearnedSkillsError extends Error {
  readonly cause?: unknown;

  constructor(
    public readonly code: LearnedSkillsErrorCode,
    public readonly retryable: boolean,
    cause?: unknown,
  ) {
    super(messages[code]);
    this.name = "LearnedSkillsError";
    // Preserve the original exception for explicit diagnostics without including
    // it in ordinary JSON serialization of this safe error envelope.
    Object.defineProperty(this, "cause", { value: cause, configurable: true });
  }
}

export interface GetLearnedSkillsSnapshotRequest {
  containerId: string;
  /** Opaque exact revision. Omit to request the latest authorized revision. */
  revision?: string;
  /** ETag from a previous snapshot. The client owns no cache. */
  ifNoneMatch?: string;
  /** Caller-owned cancellation or deadline, including AbortSignal.timeout(). */
  signal?: AbortSignal;
}

export type LearnedSkillsSnapshotResult =
  | {
      status: "snapshot";
      /** Raw ZIP bytes. The client does not parse or extract the archive. */
      bytes: Uint8Array;
      revision: string;
      etag: string;
      contentType: string;
    }
  | { status: "unchanged"; revision: string; etag: string };

/** @internal */
export function learnedSkillsResponseError(body: unknown): LearnedSkillsError {
  if (typeof body === "object" && body !== null && "error" in body) {
    const error = body.error;
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string" &&
      Object.prototype.hasOwnProperty.call(messages, error.code) &&
      "message" in error &&
      typeof error.message === "string" &&
      "category" in error &&
      typeof error.category === "string" &&
      "retryable" in error &&
      typeof error.retryable === "boolean"
    ) {
      return new LearnedSkillsError(
        error.code as LearnedSkillsErrorCode,
        error.retryable,
      );
    }
  }
  return new LearnedSkillsError("UNSUPPORTED_SERVER", false);
}
