import { GraphQLError } from "graphql";

export enum Severity {
  Error = "error",
}

export const ERROR_NAMES = {
  COPILOT_ERROR: "CopilotError",
  COPILOT_API_DISCOVERY_ERROR: "CopilotApiDiscoveryError",
  COPILOT_REMOTE_ENDPOINT_DISCOVERY_ERROR: "CopilotKitRemoteEndpointDiscoveryError",
  COPILOT_KIT_AGENT_DISCOVERY_ERROR: "CopilotKitAgentDiscoveryError",
  COPILOT_KIT_LOW_LEVEL_ERROR: "CopilotKitLowLevelError",
  RESOLVED_COPILOT_KIT_ERROR: "ResolvedCopilotKitError",
  CONFIGURATION_ERROR: "ConfigurationError",
  MISSING_PUBLIC_API_KEY_ERROR: "MissingPublicApiKeyError",
  UPGRADE_REQUIRED_ERROR: "UpgradeRequiredError",
} as const;

export enum CopilotKitErrorCode {
  NETWORK_ERROR = "NETWORK_ERROR",
  NOT_FOUND = "NOT_FOUND",
  AGENT_NOT_FOUND = "AGENT_NOT_FOUND",
  API_NOT_FOUND = "API_NOT_FOUND",
  REMOTE_ENDPOINT_NOT_FOUND = "REMOTE_ENDPOINT_NOT_FOUND",
  MISUSE = "MISUSE",
  UNKNOWN = "UNKNOWN",
  CONFIGURATION_ERROR = "CONFIGURATION_ERROR",
  MISSING_PUBLIC_API_KEY_ERROR = "MISSING_PUBLIC_API_KEY_ERROR",
  UPGRADE_REQUIRED_ERROR = "UPGRADE_REQUIRED_ERROR",
}

const BASE_URL = "https://docs.copilotkit.ai";

const getSeeMoreMarkdown = (link: string) => `See more: [${link}](${link})`;

export const ERROR_CONFIG = {
  [CopilotKitErrorCode.NETWORK_ERROR]: {
    statusCode: 503,
    troubleshootingUrl: `${BASE_URL}/troubleshooting/common-issues#i-am-getting-a-network-errors--api-not-found`,
  },
  [CopilotKitErrorCode.NOT_FOUND]: {
    statusCode: 404,
    troubleshootingUrl: `${BASE_URL}/troubleshooting/common-issues#i-am-getting-a-network-errors--api-not-found`,
  },
  [CopilotKitErrorCode.AGENT_NOT_FOUND]: {
    statusCode: 500,
    troubleshootingUrl: `${BASE_URL}/coagents/troubleshooting/common-issues#i-am-getting-agent-not-found-error`,
  },
  [CopilotKitErrorCode.API_NOT_FOUND]: {
    statusCode: 404,
    troubleshootingUrl: `${BASE_URL}/troubleshooting/common-issues#i-am-getting-a-network-errors--api-not-found`,
  },
  [CopilotKitErrorCode.REMOTE_ENDPOINT_NOT_FOUND]: {
    statusCode: 404,
    troubleshootingUrl: `${BASE_URL}/troubleshooting/common-issues#i-am-getting-copilotkits-remote-endpoint-not-found-error`,
  },
  [CopilotKitErrorCode.MISUSE]: {
    statusCode: 400,
    troubleshootingUrl: null,
  },
  [CopilotKitErrorCode.UNKNOWN]: {
    statusCode: 500,
  },
  [CopilotKitErrorCode.CONFIGURATION_ERROR]: {
    statusCode: 400,
    troubleshootingUrl: null,
    severity: Severity.Error,
  },
  [CopilotKitErrorCode.MISSING_PUBLIC_API_KEY_ERROR]: {
    statusCode: 400,
    troubleshootingUrl: null,
    severity: Severity.Error,
  },
  [CopilotKitErrorCode.UPGRADE_REQUIRED_ERROR]: {
    statusCode: 402,
    troubleshootingUrl: null,
    severity: Severity.Error,
  },
};

export class CopilotKitError extends GraphQLError {
  code: CopilotKitErrorCode;
  statusCode: number;
  severity?: Severity;
  constructor({
    message = "Unknown error occurred",
    code,
    severity,
  }: {
    message?: string;
    code: CopilotKitErrorCode;
    severity?: Severity;
  }) {
    const name = ERROR_NAMES.COPILOT_ERROR;
    const { statusCode } = ERROR_CONFIG[code];

    super(message, {
      extensions: {
        name,
        statusCode,
      },
    });
    this.code = code;
    this.name = name;
    this.statusCode = statusCode;
    this.severity = severity;
  }
}

/**
 * Error thrown when we can identify wrong usage of our components.
 * This helps us notify the developer before real errors can happen
 *
 * @extends CopilotKitError
 */
export class CopilotKitMisuseError extends CopilotKitError {
  constructor({
    message,
    code = CopilotKitErrorCode.MISUSE,
  }: {
    message: string;
    code?: CopilotKitErrorCode;
  }) {
    const docsLink =
      "troubleshootingUrl" in ERROR_CONFIG[code]
        ? getSeeMoreMarkdown(ERROR_CONFIG[code].troubleshootingUrl as string)
        : null;
    const finalMessage = docsLink ? `${message}.\n\n${docsLink}` : message;
    super({ message: finalMessage, code });
    this.name = ERROR_NAMES.COPILOT_API_DISCOVERY_ERROR;
  }
}

/**
 * Error thrown when the CopilotKit API endpoint cannot be discovered or accessed.
 * This typically occurs when:
 * - The API endpoint URL is invalid or misconfigured
 * - The API service is not running at the expected location
 * - There are network/firewall issues preventing access
 *
 * @extends CopilotKitError
 */
export class CopilotKitApiDiscoveryError extends CopilotKitError {
  constructor(
    params: {
      message?: string;
      code?: CopilotKitErrorCode.API_NOT_FOUND | CopilotKitErrorCode.REMOTE_ENDPOINT_NOT_FOUND;
    } = {},
  ) {
    const message = params.message ?? "Failed to find CopilotKit API endpoint";
    const code = params.code ?? CopilotKitErrorCode.API_NOT_FOUND;
    const errorMessage = `${message}.\n\n${getSeeMoreMarkdown(ERROR_CONFIG[code].troubleshootingUrl)}`;
    super({ message: errorMessage, code });
    this.name = ERROR_NAMES.COPILOT_API_DISCOVERY_ERROR;
  }
}

/**
 * This error is used for endpoints specified in runtime's remote endpoints. If they cannot be contacted
 * This typically occurs when:
 * - The API endpoint URL is invalid or misconfigured
 * - The API service is not running at the expected location
 *
 * @extends CopilotKitApiDiscoveryError
 */
export class CopilotKitRemoteEndpointDiscoveryError extends CopilotKitApiDiscoveryError {
  constructor(params?: { message?: string }) {
    const message = params?.message ?? "Failed to find or contact remote endpoint";
    const code = CopilotKitErrorCode.REMOTE_ENDPOINT_NOT_FOUND;
    super({ message, code });
    this.name = ERROR_NAMES.COPILOT_REMOTE_ENDPOINT_DISCOVERY_ERROR;
  }
}

/**
 * Error thrown when a LangGraph agent cannot be found or accessed.
 * This typically occurs when:
 * - The specified agent name does not exist in the deployment
 * - The agent configuration is invalid or missing
 * - The agent service is not properly deployed or initialized
 *
 * @extends CopilotKitError
 */
export class CopilotKitAgentDiscoveryError extends CopilotKitError {
  constructor(params?: { agentName?: string }) {
    const code = CopilotKitErrorCode.AGENT_NOT_FOUND;
    const baseMessage = "Failed to find agent";
    const configMessage = "Please verify the agent name exists and is properly configured.";
    const finalMessage = params?.agentName
      ? `${baseMessage} '${params.agentName}'. ${configMessage}\n\n${getSeeMoreMarkdown(ERROR_CONFIG[code].troubleshootingUrl)}`
      : `${baseMessage}. ${configMessage}\n\n${getSeeMoreMarkdown(ERROR_CONFIG[code].troubleshootingUrl)}`;
    super({ message: finalMessage || finalMessage, code });
    this.name = ERROR_NAMES.COPILOT_KIT_AGENT_DISCOVERY_ERROR;
  }
}

/**
 * Handles low-level networking errors that occur before a request reaches the server.
 * These errors arise from issues in the underlying communication infrastructure rather than
 * application-level logic or server responses. Typically used to handle "fetch failed" errors
 * where no HTTP status code is available.
 *
 * Common scenarios include:
 * - Connection failures (ECONNREFUSED) when server is down/unreachable
 * - DNS resolution failures (ENOTFOUND) when domain can't be resolved
 * - Timeouts (ETIMEDOUT) when request takes too long
 * - Protocol/transport layer errors like SSL/TLS issues
 */
export class CopilotKitLowLevelError extends CopilotKitError {
  constructor({ error, url, message }: { error: Error; url: string; message?: string }) {
    let code = CopilotKitErrorCode.NETWORK_ERROR;

    const getMessageByCode = (errorCode?: string) => {
      const troubleshootingLink = ERROR_CONFIG[code].troubleshootingUrl;
      switch (errorCode) {
        case "ECONNREFUSED":
          return `Connection to ${url} was refused. Ensure the server is running and accessible.\n\n${getSeeMoreMarkdown(troubleshootingLink)}`;
        case "ENOTFOUND":
          return `The server on ${url} could not be found. Check the URL or your network configuration.\n\n${getSeeMoreMarkdown(ERROR_CONFIG[CopilotKitErrorCode.NOT_FOUND].troubleshootingUrl)}`;
        case "ETIMEDOUT":
          return `The connection to ${url} timed out. The server might be overloaded or taking too long to respond.\n\n${getSeeMoreMarkdown(troubleshootingLink)}`;
        default:
          return `Failed to fetch from url ${url}.

Possible reasons:
- -The server might be down or unreachable
- -There might be a network issue (e.g., DNS failure, connection timeout) 
- -The URL might be incorrect
- -The server is not running on the specified port

${getSeeMoreMarkdown(troubleshootingLink)}`;
      }
    };
    // @ts-expect-error -- code may exist
    const errorMessage = message ?? getMessageByCode(error.code as string);

    super({ message: errorMessage, code });

    this.name = ERROR_NAMES.COPILOT_KIT_LOW_LEVEL_ERROR;
  }
}

/**
 * Generic catch-all error handler for HTTP responses from the CopilotKit API where a status code is available.
 * Used when we receive an HTTP error status and wish to handle broad range of them
 *
 * This differs from CopilotKitLowLevelError in that:
 * - ResolvedCopilotKitError: Server was reached and returned an HTTP status
 * - CopilotKitLowLevelError: Error occurred before reaching server (e.g. network failure)
 *
 * @param status - The HTTP status code received from the API response
 * @param message - Optional error message to include
 * @param code - Optional specific CopilotKitErrorCode to override default behavior
 *
 * Default behavior:
 * - 400 Bad Request: Maps to CopilotKitApiDiscoveryError
 * - All other status codes: Maps to UNKNOWN error code if no specific code provided
 */
export class ResolvedCopilotKitError extends CopilotKitError {
  constructor({
    status,
    message,
    code,
    isRemoteEndpoint,
  }: {
    status: number;
    message?: string;
    code?: CopilotKitErrorCode;
    isRemoteEndpoint?: boolean;
  }) {
    let resolvedCode = code;
    if (!resolvedCode) {
      switch (status) {
        case 400:
          throw new CopilotKitApiDiscoveryError({ message });
        case 404:
          throw isRemoteEndpoint
            ? new CopilotKitRemoteEndpointDiscoveryError({ message })
            : new CopilotKitApiDiscoveryError({ message });
        default:
          resolvedCode = CopilotKitErrorCode.UNKNOWN;
          super({ message, code: resolvedCode });
      }
    } else {
      super({ message, code: resolvedCode });
    }
    this.name = ERROR_NAMES.RESOLVED_COPILOT_KIT_ERROR;
  }
}

export class ConfigurationError extends CopilotKitError {
  constructor(message: string) {
    super({ message, code: CopilotKitErrorCode.CONFIGURATION_ERROR });
    this.name = ERROR_NAMES.CONFIGURATION_ERROR;
    this.severity = Severity.Error;
  }
}

export class MissingPublicApiKeyError extends ConfigurationError {
  constructor(message: string) {
    super(message);
    this.name = ERROR_NAMES.MISSING_PUBLIC_API_KEY_ERROR;
    this.severity = Severity.Error;
  }
}

export class UpgradeRequiredError extends ConfigurationError {
  constructor(message: string) {
    super(message);
    this.name = ERROR_NAMES.UPGRADE_REQUIRED_ERROR;
    this.severity = Severity.Error;
  }
}
