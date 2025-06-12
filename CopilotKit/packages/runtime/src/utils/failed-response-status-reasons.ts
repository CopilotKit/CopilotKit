import {
  FailedResponseStatus,
  FailedResponseStatusReason,
} from "../graphql/types/response-status.type";

export class GuardrailsValidationFailureResponse extends FailedResponseStatus {
  reason = FailedResponseStatusReason.GUARDRAILS_VALIDATION_FAILED;
  declare details: {
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
  declare details: {
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

export class StructuredErrorResponse extends FailedResponseStatus {
  reason = FailedResponseStatusReason.STRUCTURED_ERROR;
  declare details: {
    categorizedError: any; // Full categorized error object
    description: string; // Human-readable description
  };

  constructor({ categorizedError, description }: { categorizedError: any; description: string }) {
    super();
    this.details = {
      categorizedError,
      description,
    };
  }
}

export class UnknownErrorResponse extends FailedResponseStatus {
  reason = FailedResponseStatusReason.UNKNOWN_ERROR;
  declare details: {
    description?: string;
  };

  constructor({ description }: { description?: string }) {
    super();
    this.details = {
      description,
    };
  }
}
