import type {
  CreateElicitationResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";
import type { ResumeEntry } from "@ag-ui/client";

/** Stable validation codes for AG-UI interrupt responses. */
export type AcpInterruptResolutionErrorCode =
  | "invalid_payload"
  | "unknown_interrupt"
  | "unknown_permission_option";

/** Rejects an unsafe or unrelated AG-UI resume before it reaches ACP. */
export class AcpInterruptResolutionError extends Error {
  constructor(
    readonly code: AcpInterruptResolutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AcpInterruptResolutionError";
  }
}

/** Converts one validated AG-UI resume into the pending ACP permission response. */
export function resolveAcpPermissionResume(
  resume: ResumeEntry,
  request: RequestPermissionRequest,
  expectedInterruptId: string,
): RequestPermissionResponse {
  if (resume.interruptId !== expectedInterruptId) {
    throw new AcpInterruptResolutionError(
      "unknown_interrupt",
      "The AG-UI resume does not match the pending ACP permission request",
    );
  }
  if (resume.status === "cancelled") {
    return { outcome: { outcome: "cancelled" } };
  }
  const payload = resume.payload;
  const optionId =
    typeof payload === "object" &&
    payload !== null &&
    "optionId" in payload &&
    typeof payload.optionId === "string"
      ? payload.optionId
      : undefined;
  if (!optionId) {
    throw new AcpInterruptResolutionError(
      "invalid_payload",
      "The AG-UI permission response must contain an ACP optionId",
    );
  }
  if (!request.options.some((option) => option.optionId === optionId)) {
    throw new AcpInterruptResolutionError(
      "unknown_permission_option",
      "The AG-UI permission response selected an unknown ACP optionId",
    );
  }
  return { outcome: { outcome: "selected", optionId } };
}

const isElicitationContent = (
  value: unknown,
): value is Record<string, string | number | boolean | string[]> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every(
    (entry) =>
      typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean" ||
      (Array.isArray(entry) && entry.every((item) => typeof item === "string")),
  );

/** Converts a validated AG-UI resume into one ACP elicitation response. */
export function resolveAcpElicitationResume(
  resume: ResumeEntry,
  expectedInterruptId: string,
): CreateElicitationResponse {
  if (resume.interruptId !== expectedInterruptId) {
    throw new AcpInterruptResolutionError(
      "unknown_interrupt",
      "The AG-UI resume does not match the pending ACP elicitation",
    );
  }
  if (resume.status === "cancelled") return { action: "cancel" };
  const payload = resume.payload;
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("action" in payload)
  ) {
    throw new AcpInterruptResolutionError(
      "invalid_payload",
      "The AG-UI elicitation response must contain an action",
    );
  }
  if (payload.action === "decline") return { action: "decline" };
  if (payload.action !== "accept") {
    throw new AcpInterruptResolutionError(
      "invalid_payload",
      "The AG-UI elicitation action must be accept or decline",
    );
  }
  const content = "content" in payload ? payload.content : undefined;
  if (
    content !== undefined &&
    content !== null &&
    !isElicitationContent(content)
  ) {
    throw new AcpInterruptResolutionError(
      "invalid_payload",
      "The AG-UI elicitation content contains an unsupported value",
    );
  }
  return {
    action: "accept",
    ...(content === undefined ? {} : { content }),
  };
}
