/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/runtime — GuardrailsValidationFailureResponse:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/runtime — MessageStreamInterruptedResponse:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/runtime — UnknownErrorResponse:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 * V1 source file: packages/runtime/src/utils/failed-response-status-reasons.ts
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

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

export class UnknownErrorResponse extends FailedResponseStatus {
  reason = FailedResponseStatusReason.UNKNOWN_ERROR;
  declare details: {
    description?: string;
    originalError?: {
      code?: string;
      statusCode?: number;
      severity?: string;
      visibility?: string;
      originalErrorType?: string;
      extensions?: any;
    };
  };

  constructor({
    description,
    originalError,
  }: {
    description?: string;
    originalError?: {
      code?: string;
      statusCode?: number;
      severity?: string;
      visibility?: string;
      originalErrorType?: string;
      extensions?: any;
    };
  }) {
    super();
    this.details = {
      description,
      originalError,
    };
  }
}
