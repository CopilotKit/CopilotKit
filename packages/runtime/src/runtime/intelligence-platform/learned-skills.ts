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

export interface GetLearnedSkillsSnapshotsRequest {
  containers: readonly Omit<GetLearnedSkillsSnapshotRequest, "signal">[];
  signal?: AbortSignal;
}
export type LearnedSkillsBatchResult = { containerId: string } & (
  | LearnedSkillsSnapshotResult
  | { status: "error"; error: LearnedSkillsError }
);

/** Validate the entire envelope before exposing any individual result. */
export function parseLearnedSkillsBatch(
  body: unknown,
  requests: GetLearnedSkillsSnapshotsRequest["containers"],
): LearnedSkillsBatchResult[] {
  const invalid = () => {
    if (
      body &&
      typeof body === "object" &&
      "containers" in body &&
      Array.isArray(body.containers)
    ) {
      const denial = body.containers.find(
        (entry) =>
          entry &&
          requests.some(
            (request) => request.containerId === entry.containerId,
          ) &&
          entry.status === "error" &&
          [
            "AUTHENTICATION_FAILED",
            "AUTHORIZATION_FAILED",
            "ENTITLEMENT_REQUIRED",
            "DELIVERY_DISABLED",
            "CONTAINER_NOT_FOUND",
            "REVISION_NOT_FOUND",
            "REVISION_REVOKED",
          ].includes(entry.error?.code),
      );
      if (denial) return new LearnedSkillsError(denial.error.code, false);
    }
    return new LearnedSkillsError("INVALID_SNAPSHOT", false);
  };
  if (
    !body ||
    typeof body !== "object" ||
    !("containers" in body) ||
    !Array.isArray(body.containers) ||
    body.containers.length !== requests.length
  )
    throw invalid();
  return body.containers.map((entry, index) => {
    const request = requests[index];
    if (
      !entry ||
      typeof entry !== "object" ||
      entry.containerId !== request.containerId
    )
      throw invalid();
    if (entry.status === "error") {
      if (
        !entry.error ||
        typeof entry.error !== "object" ||
        !Object.prototype.hasOwnProperty.call(messages, entry.error.code) ||
        typeof entry.error.retryable !== "boolean"
      )
        throw invalid();
      return {
        containerId: entry.containerId,
        status: "error",
        error: new LearnedSkillsError(entry.error.code, entry.error.retryable),
      };
    }
    if (
      typeof entry.revision !== "string" ||
      !entry.revision.trim() ||
      typeof entry.etag !== "string" ||
      !/^"[a-f0-9]{64}"$/.test(entry.etag) ||
      (request.revision !== undefined && entry.revision !== request.revision)
    )
      throw invalid();
    if (entry.status === "unchanged") {
      if (
        request.ifNoneMatch !== entry.etag ||
        "bytesBase64" in entry ||
        "contentType" in entry
      )
        throw invalid();
      return {
        containerId: entry.containerId,
        status: "unchanged",
        revision: entry.revision,
        etag: entry.etag,
      };
    }
    if (
      entry.status !== "snapshot" ||
      entry.contentType !== "application/zip" ||
      typeof entry.bytesBase64 !== "string" ||
      !entry.bytesBase64.length ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        entry.bytesBase64,
      )
    )
      throw invalid();
    const bytes = Buffer.from(entry.bytesBase64, "base64");
    if (bytes.toString("base64") !== entry.bytesBase64) throw invalid();
    return {
      containerId: entry.containerId,
      status: "snapshot",
      revision: entry.revision,
      etag: entry.etag,
      contentType: entry.contentType,
      bytes: new Uint8Array(bytes),
    };
  });
}
