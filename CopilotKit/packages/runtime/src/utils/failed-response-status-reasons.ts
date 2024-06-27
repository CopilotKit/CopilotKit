import { FailedResponseStatus } from "../graphql/types/response-status.type";

export enum FailedResponseStatusReason {
  GUARDRAILS_VALIDATION_FAILED = "GUARDRAILS_VALIDATION_FAILED",
  MESSAGE_STREAM_INTERRUPTED = "MESSAGE_STREAM_INTERRUPTED",
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
}

export class GuardrailsValidationFailureResponse extends FailedResponseStatus {
  reason = FailedResponseStatusReason.GUARDRAILS_VALIDATION_FAILED;
  details: {
    guardrailsReason: string;
  };

  constructor({ guardrailsReason }) {
    super();
    this.details = {
      guardrailsReason,
    };
  }
}

export class MessageStreamInterruptedResponse extends FailedResponseStatus {
  reason = FailedResponseStatusReason.MESSAGE_STREAM_INTERRUPTED;
  details: {
    messageId: string;
    description: string;
  };

  constructor({ messageId }: { messageId: string }) {
    super();
    this.details = {
      messageId,
      description: "Check the message for mode details",
    };
  }
}

export class UnknownErrorResponse extends FailedResponseStatus {
  reason = FailedResponseStatusReason.UNKNOWN_ERROR;
  details: {
    description?: string;
  };

  constructor({ description }: { description?: string }) {
    super();
    this.details = {
      description,
    };
  }
}
