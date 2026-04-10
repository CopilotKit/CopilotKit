import type { GraphQLContext } from "../integrations";
import type { CopilotKitEndpoint } from "./types";
import { CopilotKitError, CopilotKitLowLevelError } from "@copilotkit/shared";

// Utility to determine if an error is a user configuration issue vs system error
export function isUserConfigurationError(error: any): boolean {
  return (
    (error instanceof CopilotKitError ||
      error instanceof CopilotKitLowLevelError) &&
    (error.code === "NETWORK_ERROR" ||
      error.code === "AUTHENTICATION_ERROR" ||
      error.statusCode === 401 ||
      error.statusCode === 403 ||
      error.message?.toLowerCase().includes("authentication") ||
      error.message?.toLowerCase().includes("api key"))
  );
}

export function createHeaders(
  onBeforeRequest: CopilotKitEndpoint["onBeforeRequest"],
  graphqlContext: GraphQLContext,
) {
  const headers = {
    "Content-Type": "application/json",
  };

  if (onBeforeRequest) {
    const { headers: additionalHeaders } = onBeforeRequest({
      ctx: graphqlContext,
    });
    if (additionalHeaders) {
      Object.assign(headers, additionalHeaders);
    }
  }

  return headers;
}
