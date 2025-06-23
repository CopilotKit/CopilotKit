import { GraphQLError } from "graphql";
import { COPILOTKIT_VERSION } from "../index";

export enum Severity {
  CRITICAL = "critical", // Critical errors that block core functionality
  WARNING = "warning", // Configuration/setup issues that need attention
  INFO = "info", // General errors and network issues
}

export enum ErrorVisibility {
  BANNER = "banner", // Critical errors shown as fixed banners
  TOAST = "toast", // Regular errors shown as dismissible toasts
  SILENT = "silent", // Errors logged but not shown to user
  DEV_ONLY = "dev_only", // Errors only shown in development mode
}

export const ERROR_NAMES = {
  COPILOT_ERROR: "CopilotError",
  COPILOT_API_DISCOVERY_ERROR: "CopilotApiDiscoveryError",
  COPILOT_REMOTE_ENDPOINT_DISCOVERY_ERROR: "CopilotKitRemoteEndpointDiscoveryError",
  COPILOT_KIT_AGENT_DISCOVERY_ERROR: "CopilotKitAgentDiscoveryError",
  COPILOT_KIT_LOW_LEVEL_ERROR: "CopilotKitLowLevelError",
  COPILOT_KIT_VERSION_MISMATCH_ERROR: "CopilotKitVersionMismatchError",
  RESOLVED_COPILOT_KIT_ERROR: "ResolvedCopilotKitError",
  CONFIGURATION_ERROR: "ConfigurationError",
  MISSING_PUBLIC_API_KEY_ERROR: "MissingPublicApiKeyError",
  UPGRADE_REQUIRED_ERROR: "UpgradeRequiredError",
} as const;

// Banner errors - critical configuration/discovery issues
export const BANNER_ERROR_NAMES = [
  ERROR_NAMES.CONFIGURATION_ERROR,
  ERROR_NAMES.MISSING_PUBLIC_API_KEY_ERROR,
  ERROR_NAMES.UPGRADE_REQUIRED_ERROR,
  ERROR_NAMES.COPILOT_API_DISCOVERY_ERROR,
  ERROR_NAMES.COPILOT_REMOTE_ENDPOINT_DISCOVERY_ERROR,
  ERROR_NAMES.COPILOT_KIT_AGENT_DISCOVERY_ERROR,
];

// Legacy cloud error names for backward compatibility
export const COPILOT_CLOUD_ERROR_NAMES = BANNER_ERROR_NAMES;

export enum CopilotKitErrorCode {
  NETWORK_ERROR = "NETWORK_ERROR",
  NOT_FOUND = "NOT_FOUND",
  AGENT_NOT_FOUND = "AGENT_NOT_FOUND",
  API_NOT_FOUND = "API_NOT_FOUND",
  REMOTE_ENDPOINT_NOT_FOUND = "REMOTE_ENDPOINT_NOT_FOUND",
  AUTHENTICATION_ERROR = "AUTHENTICATION_ERROR",
  MISUSE = "MISUSE",
  UNKNOWN = "UNKNOWN",
  VERSION_MISMATCH = "VERSION_MISMATCH",
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
    visibility: ErrorVisibility.BANNER,
    severity: Severity.CRITICAL,
  },
  [CopilotKitErrorCode.NOT_FOUND]: {
    statusCode: 404,
    troubleshootingUrl: `${BASE_URL}/troubleshooting/common-issues#i-am-getting-a-network-errors--api-not-found`,
    visibility: ErrorVisibility.BANNER,
    severity: Severity.CRITICAL,
  },
  [CopilotKitErrorCode.AGENT_NOT_FOUND]: {
    statusCode: 500,
    troubleshootingUrl: `${BASE_URL}/coagents/troubleshooting/common-issues#i-am-getting-agent-not-found-error`,
    visibility: ErrorVisibility.BANNER,
    severity: Severity.CRITICAL,
  },
  [CopilotKitErrorCode.API_NOT_FOUND]: {
    statusCode: 404,
    troubleshootingUrl: `${BASE_URL}/troubleshooting/common-issues#i-am-getting-a-network-errors--api-not-found`,
    visibility: ErrorVisibility.BANNER,
    severity: Severity.CRITICAL,
  },
  [CopilotKitErrorCode.REMOTE_ENDPOINT_NOT_FOUND]: {
    statusCode: 404,
    troubleshootingUrl: `${BASE_URL}/troubleshooting/common-issues#i-am-getting-copilotkits-remote-endpoint-not-found-error`,
    visibility: ErrorVisibility.BANNER,
    severity: Severity.CRITICAL,
  },
  [CopilotKitErrorCode.AUTHENTICATION_ERROR]: {
    statusCode: 401,
    troubleshootingUrl: `${BASE_URL}/troubleshooting/common-issues#authentication-errors`,
    visibility: ErrorVisibility.BANNER,
    severity: Severity.CRITICAL,
  },
  [CopilotKitErrorCode.MISUSE]: {
    statusCode: 400,
    troubleshootingUrl: null,
    visibility: ErrorVisibility.DEV_ONLY,
    severity: Severity.WARNING,
  },
  [CopilotKitErrorCode.UNKNOWN]: {
    statusCode: 500,
    visibility: ErrorVisibility.TOAST,
    severity: Severity.CRITICAL,
  },
  [CopilotKitErrorCode.CONFIGURATION_ERROR]: {
    statusCode: 400,
    troubleshootingUrl: null,
    severity: Severity.WARNING,
    visibility: ErrorVisibility.BANNER,
  },
  [CopilotKitErrorCode.MISSING_PUBLIC_API_KEY_ERROR]: {
    statusCode: 400,
    troubleshootingUrl: null,
    severity: Severity.CRITICAL,
    visibility: ErrorVisibility.BANNER,
  },
  [CopilotKitErrorCode.UPGRADE_REQUIRED_ERROR]: {
    statusCode: 402,
    troubleshootingUrl: null,
    severity: Severity.WARNING,
    visibility: ErrorVisibility.BANNER,
  },
  [CopilotKitErrorCode.VERSION_MISMATCH]: {
    statusCode: 400,
    troubleshootingUrl: null,
    visibility: ErrorVisibility.DEV_ONLY,
    severity: Severity.INFO,
  },
};

export class CopilotKitError extends GraphQLError {
  code: CopilotKitErrorCode;
  statusCode: number;
  severity?: Severity;
  visibility: ErrorVisibility;

  constructor({
    message = "Unknown error occurred",
    code,
    severity,
    visibility,
  }: {
    message?: string;
    code: CopilotKitErrorCode;
    severity?: Severity;
    visibility?: ErrorVisibility;
  }) {
    const name = ERROR_NAMES.COPILOT_ERROR;
    const config = ERROR_CONFIG[code];
    const { statusCode } = config;
    const resolvedVisibility = visibility ?? config.visibility ?? ErrorVisibility.TOAST;
    const resolvedSeverity = severity ?? ("severity" in config ? config.severity : undefined);

    super(message, {
      extensions: {
        name,
        statusCode,
        code,
        visibility: resolvedVisibility,
        severity: resolvedSeverity,
        troubleshootingUrl: "troubleshootingUrl" in config ? config.troubleshootingUrl : null,
        originalError: {
          message,
          stack: new Error().stack,
        },
      },
    });

    this.code = code;
    this.name = name;
    this.statusCode = statusCode;
    this.severity = resolvedSeverity;
    this.visibility = resolvedVisibility;
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
      "troubleshootingUrl" in ERROR_CONFIG[code] && ERROR_CONFIG[code].troubleshootingUrl
        ? getSeeMoreMarkdown(ERROR_CONFIG[code].troubleshootingUrl as string)
        : null;
    const finalMessage = docsLink ? `${message}.\n\n${docsLink}` : message;
    super({ message: finalMessage, code });
    this.name = ERROR_NAMES.COPILOT_API_DISCOVERY_ERROR;
  }
}

const getVersionMismatchErrorMessage = ({
  reactCoreVersion,
  runtimeVersion,
  runtimeClientGqlVersion,
}: VersionMismatchResponse) =>
  `Version mismatch detected: @copilotkit/runtime@${runtimeVersion ?? ""} is not compatible with @copilotkit/react-core@${reactCoreVersion} and @copilotkit/runtime-client-gql@${runtimeClientGqlVersion}. Please ensure all installed copilotkit packages are on the same version.`;
/**
 * Error thrown when CPK versions does not match
 *
 * @extends CopilotKitError
 */
export class CopilotKitVersionMismatchError extends CopilotKitError {
  constructor({
    reactCoreVersion,
    runtimeVersion,
    runtimeClientGqlVersion,
  }: VersionMismatchResponse) {
    const code = CopilotKitErrorCode.VERSION_MISMATCH;
    super({
      message: getVersionMismatchErrorMessage({
        reactCoreVersion,
        runtimeVersion,
        runtimeClientGqlVersion,
      }),
      code,
    });
    this.name = ERROR_NAMES.COPILOT_KIT_VERSION_MISMATCH_ERROR;
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
      url?: string;
    } = {},
  ) {
    const url = params.url ?? "";
    let operationSuffix = "";
    if (url?.includes("/info")) operationSuffix = `when fetching CopilotKit info`;
    else if (url.includes("/actions/execute"))
      operationSuffix = `when attempting to execute actions.`;
    else if (url.includes("/agents/state")) operationSuffix = `when attempting to get agent state.`;
    else if (url.includes("/agents/execute"))
      operationSuffix = `when attempting to execute agent(s).`;
    const message =
      params.message ??
      (params.url
        ? `Failed to find CopilotKit API endpoint at url ${params.url} ${operationSuffix}`
        : `Failed to find CopilotKit API endpoint.`);
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
  constructor(params?: { message?: string; url?: string }) {
    const message =
      params?.message ??
      (params?.url
        ? `Failed to find or contact remote endpoint at url ${params.url}`
        : "Failed to find or contact remote endpoint");
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
  constructor(params: { agentName?: string; availableAgents: { name: string; id: string }[] }) {
    const { agentName, availableAgents } = params;
    const code = CopilotKitErrorCode.AGENT_NOT_FOUND;

    const seeMore = getSeeMoreMarkdown(ERROR_CONFIG[code].troubleshootingUrl);
    let message;

    if (availableAgents.length) {
      const agentList = availableAgents.map((agent) => agent.name).join(", ");

      if (agentName) {
        message = `Agent '${agentName}' was not found. Available agents are: ${agentList}. Please verify the agent name in your configuration and ensure it matches one of the available agents.\n\n${seeMore}`;
      } else {
        message = `The requested agent was not found. Available agents are: ${agentList}. Please verify the agent name in your configuration and ensure it matches one of the available agents.\n\n${seeMore}`;
      }
    } else {
      message = `${agentName ? `Agent '${agentName}'` : "The requested agent"} was not found. Please set up at least one agent before proceeding. ${seeMore}`;
    }

    super({ message, code });
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

    // @ts-expect-error -- code may exist
    const errorCode = error.code as string;
    const errorMessage = message ?? resolveLowLevelErrorMessage({ errorCode, url });

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
    url,
  }: {
    status: number;
    message?: string;
    code?: CopilotKitErrorCode;
    isRemoteEndpoint?: boolean;
    url?: string;
  }) {
    let resolvedCode = code;
    if (!resolvedCode) {
      switch (status) {
        case 400:
          throw new CopilotKitApiDiscoveryError({ message, url });
        case 404:
          throw isRemoteEndpoint
            ? new CopilotKitRemoteEndpointDiscoveryError({ message, url })
            : new CopilotKitApiDiscoveryError({ message, url });
        default:
          resolvedCode = CopilotKitErrorCode.UNKNOWN;
          break;
      }
    }

    super({ message, code: resolvedCode });
    this.name = ERROR_NAMES.RESOLVED_COPILOT_KIT_ERROR;
  }
}

export class ConfigurationError extends CopilotKitError {
  constructor(message: string) {
    super({ message, code: CopilotKitErrorCode.CONFIGURATION_ERROR });
    this.name = ERROR_NAMES.CONFIGURATION_ERROR;
    this.severity = Severity.WARNING;
  }
}

export class MissingPublicApiKeyError extends ConfigurationError {
  constructor(message: string) {
    super(message);
    this.name = ERROR_NAMES.MISSING_PUBLIC_API_KEY_ERROR;
    this.severity = Severity.CRITICAL;
  }
}

export class UpgradeRequiredError extends ConfigurationError {
  constructor(message: string) {
    super(message);
    this.name = ERROR_NAMES.UPGRADE_REQUIRED_ERROR;
    this.severity = Severity.WARNING;
  }
}

/**
 * Checks if an error is already a structured CopilotKit error.
 * This utility centralizes the logic for detecting structured errors across the codebase.
 *
 * @param error - The error to check
 * @returns true if the error is already structured, false otherwise
 */
export function isStructuredCopilotKitError(error: any): boolean {
  return (
    error instanceof CopilotKitError ||
    error instanceof CopilotKitLowLevelError ||
    (error?.name && error.name.includes("CopilotKit")) ||
    error?.extensions?.code !== undefined // Check if it has our structured error properties
  );
}

/**
 * Returns the error as-is if it's already structured, otherwise converts it using the provided converter function.
 * This utility centralizes the pattern of preserving structured errors while converting unstructured ones.
 *
 * @param error - The error to process
 * @param converter - Function to convert unstructured errors to structured ones
 * @returns The structured error
 */
export function ensureStructuredError<T extends CopilotKitError>(
  error: any,
  converter: (error: any) => T,
): T | any {
  return isStructuredCopilotKitError(error) ? error : converter(error);
}

interface VersionMismatchResponse {
  runtimeVersion?: string;
  runtimeClientGqlVersion: string;
  reactCoreVersion: string;
}

export async function getPossibleVersionMismatch({
  runtimeVersion,
  runtimeClientGqlVersion,
}: {
  runtimeVersion?: string;
  runtimeClientGqlVersion: string;
}) {
  if (!runtimeVersion || runtimeVersion === "" || !runtimeClientGqlVersion) return;
  if (
    COPILOTKIT_VERSION !== runtimeVersion ||
    COPILOTKIT_VERSION !== runtimeClientGqlVersion ||
    runtimeVersion !== runtimeClientGqlVersion
  ) {
    return {
      runtimeVersion,
      runtimeClientGqlVersion,
      reactCoreVersion: COPILOTKIT_VERSION,
      message: getVersionMismatchErrorMessage({
        runtimeVersion,
        runtimeClientGqlVersion,
        reactCoreVersion: COPILOTKIT_VERSION,
      }),
    };
  }

  return;
}

const resolveLowLevelErrorMessage = ({ errorCode, url }: { errorCode?: string; url: string }) => {
  const troubleshootingLink = ERROR_CONFIG[CopilotKitErrorCode.NETWORK_ERROR].troubleshootingUrl;
  const genericMessage = (description = `Failed to fetch from url ${url}.`) => `${description}.

Possible reasons:
- -The server may have an error preventing it from returning a response (Check the server logs for more info).
- -The server might be down or unreachable
- -There might be a network issue (e.g., DNS failure, connection timeout) 
- -The URL might be incorrect
- -The server is not running on the specified port

${getSeeMoreMarkdown(troubleshootingLink)}`;

  if (url.includes("/info"))
    return genericMessage(`Failed to fetch CopilotKit agents/action information from url ${url}.`);
  if (url.includes("/actions/execute"))
    return genericMessage(`Fetch call to ${url} to execute actions failed.`);
  if (url.includes("/agents/state"))
    return genericMessage(`Fetch call to ${url} to get agent state failed.`);
  if (url.includes("/agents/execute"))
    return genericMessage(`Fetch call to ${url} to execute agent(s) failed.`);

  switch (errorCode) {
    case "ECONNREFUSED":
      return `Connection to ${url} was refused. Ensure the server is running and accessible.\n\n${getSeeMoreMarkdown(troubleshootingLink)}`;
    case "ENOTFOUND":
      return `The server on ${url} could not be found. Check the URL or your network configuration.\n\n${getSeeMoreMarkdown(ERROR_CONFIG[CopilotKitErrorCode.NOT_FOUND].troubleshootingUrl)}`;
    case "ETIMEDOUT":
      return `The connection to ${url} timed out. The server might be overloaded or taking too long to respond.\n\n${getSeeMoreMarkdown(troubleshootingLink)}`;
    default:
      return;
  }
};
