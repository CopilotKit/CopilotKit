import { TelemetryClient } from "@copilotkit/shared";
import { EndpointType, LangGraphPlatformEndpoint } from "./runtime/remote-actions";
import { createHash } from "node:crypto";
import { CopilotRuntime, resolveEndpointType } from "./runtime/copilot-runtime";
import { RuntimeInstanceCreatedInfo } from "@copilotkit/shared/src/telemetry/events";
import { CreateCopilotRuntimeServerOptions } from "./integrations/shared";
const packageJson = require("../../package.json");

const telemetryClient = new TelemetryClient({
  packageName: packageJson.name,
  packageVersion: packageJson.version,
});

export function getRuntimeInstanceTelemetryInfo(
  options: CreateCopilotRuntimeServerOptions,
): RuntimeInstanceCreatedInfo {
  const runtime = options.runtime;
  const endpointsInfo = runtime.remoteEndpointDefinitions.reduce(
    (acc, endpoint) => {
      let info = { ...acc };

      const endpointType = resolveEndpointType(endpoint);
      if (!info.endpointTypes.includes(endpointType)) {
        info = {
          ...info,
          endpointTypes: [...info.endpointTypes, endpointType],
        };
      }

      if (endpointType === EndpointType.LangGraphPlatform) {
        // When type is resolved, recreating a const with casting of type
        const ep = endpoint as LangGraphPlatformEndpoint;
        info = {
          ...info,
          agentsAmount: ep.agents.length,
          hashedKey: ep.langsmithApiKey
            ? createHash("sha256").update(ep.langsmithApiKey).digest("hex")
            : null,
        };
      }

      return info;
    },
    { endpointTypes: [], agentsAmount: null, hashedKey: null },
  );

  // Get public API key from options.cloud.publicApiKey
  const publicApiKey = options.cloud?.publicApiKey;
  const apiKeyProvided = !!publicApiKey && publicApiKey.trim().length > 0;

  return {
    actionsAmount: runtime.actions.length,
    endpointsAmount: runtime.remoteEndpointDefinitions.length,
    endpointTypes: endpointsInfo.endpointTypes,
    agentsAmount: endpointsInfo.agentsAmount,
    hashedLgcKey: endpointsInfo.hashedKey,
    "cloud.api_key_provided": apiKeyProvided,
    ...(apiKeyProvided ? { "cloud.public_api_key": publicApiKey } : {}),
    ...(options.cloud?.baseUrl ? { "cloud.base_url": options.cloud.baseUrl } : {}),
  } as RuntimeInstanceCreatedInfo;
}

export default telemetryClient;
