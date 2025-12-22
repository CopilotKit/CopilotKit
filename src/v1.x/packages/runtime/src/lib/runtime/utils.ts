import { GraphQLContext } from "../integrations";
import { Logger } from "pino";
import { CopilotKitEndpoint, RemoteActionInfoResponse } from "./types";
import {
  Action,
  CopilotKitError,
  CopilotKitLowLevelError,
  ResolvedCopilotKitError,
} from "@copilotkit/shared";

async function fetchRemoteInfo({
  url,
  onBeforeRequest,
  graphqlContext,
  logger,
  frontendUrl,
}: {
  url: string;
  onBeforeRequest?: CopilotKitEndpoint["onBeforeRequest"];
  graphqlContext: GraphQLContext;
  logger: Logger;
  frontendUrl?: string;
}): Promise<RemoteActionInfoResponse> {
  logger.debug({ url }, "Fetching actions from url");
  const headers = createHeaders(onBeforeRequest, graphqlContext);

  const fetchUrl = `${url}/info`;
  try {
    const response = await fetch(fetchUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ properties: graphqlContext.properties, frontendUrl }),
    });

    if (!response.ok) {
      logger.error(
        { url, status: response.status, body: await response.text() },
        "Failed to fetch actions from url",
      );
      throw new ResolvedCopilotKitError({
        status: response.status,
        url: fetchUrl,
        isRemoteEndpoint: true,
      });
    }

    const json = await response.json();
    logger.debug({ json }, "Fetched actions from url");
    return json;
  } catch (error) {
    if (error instanceof CopilotKitError) {
      throw error;
    }
    throw new CopilotKitLowLevelError({ error, url: fetchUrl });
  }
}

// Utility to determine if an error is a user configuration issue vs system error
export function isUserConfigurationError(error: any): boolean {
  return (
    (error instanceof CopilotKitError || error instanceof CopilotKitLowLevelError) &&
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
    const { headers: additionalHeaders } = onBeforeRequest({ ctx: graphqlContext });
    if (additionalHeaders) {
      Object.assign(headers, additionalHeaders);
    }
  }

  return headers;
}
