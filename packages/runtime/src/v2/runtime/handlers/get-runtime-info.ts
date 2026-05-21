import type { AgentCapabilities } from "@ag-ui/core";
import type { CopilotRuntimeLike } from "../core/runtime";
import { isIntelligenceRuntime, resolveAgents } from "../core/runtime";
import type { AgentDescription, RuntimeInfo } from "@copilotkit/shared";
import type { RuntimeLicenseStatus } from "@copilotkit/shared";
import { VERSION } from "../core/runtime";
import { isTelemetryDisabled } from "../telemetry/telemetry-client";
import { InMemoryAgentRunner } from "../runner/in-memory";

function resolveLicenseStatus(
  runtime: CopilotRuntimeLike,
): RuntimeLicenseStatus {
  if (!runtime.licenseChecker) return "none";
  const status = runtime.licenseChecker.getStatus();
  if (status.warningSeverity === "none") return "valid";
  if (status.error === "expired") return "expired";
  if (status.warningSeverity === "warning") return "expiring";
  if (status.error) return "invalid";
  if (status.warningSeverity === "info") return "none";
  return "unknown";
}

interface HandleGetRuntimeInfoParameters {
  runtime: CopilotRuntimeLike;
  request: Request;
  threadEndpointsEnabled?: boolean;
}

export async function handleGetRuntimeInfo({
  runtime,
  request,
  threadEndpointsEnabled = true,
}: HandleGetRuntimeInfoParameters) {
  try {
    const agents = await resolveAgents(runtime.agents, request);

    const agentEntries = await Promise.all(
      Object.entries(agents).map(async ([name, agent]) => {
        let capabilities: AgentCapabilities | undefined;
        try {
          capabilities = agent.getCapabilities
            ? await agent.getCapabilities()
            : undefined;
        } catch (error) {
          // Per-agent isolation: a single agent failing to report capabilities
          // must not take down the entire /info endpoint.
          console.warn(
            `Failed to fetch capabilities for agent "${name}":`,
            error instanceof Error ? error.message : error,
          );
          capabilities = undefined;
        }

        const description: AgentDescription = {
          name,
          description: agent.description,
          className: agent.constructor.name,
          ...(capabilities ? { capabilities } : {}),
        };

        return [name, description] as const;
      }),
    );

    const agentsDict: Record<string, AgentDescription> =
      Object.fromEntries(agentEntries);

    const runtimeInfo: RuntimeInfo = {
      version: VERSION,
      agents: agentsDict,
      audioFileTranscriptionEnabled: !!runtime.transcriptionService,
      mode: runtime.mode,
      threadEndpoints: resolveThreadEndpointInfo(
        runtime,
        threadEndpointsEnabled,
      ),
      ...(isIntelligenceRuntime(runtime)
        ? {
            intelligence: {
              wsUrl: runtime.intelligence.ɵgetClientWsUrl(),
            },
          }
        : {}),
      a2uiEnabled: !!runtime.a2ui,
      openGenerativeUIEnabled: !!runtime.openGenerativeUI,
      ...(isIntelligenceRuntime(runtime)
        ? { licenseStatus: resolveLicenseStatus(runtime) }
        : {}),
      telemetryDisabled: isTelemetryDisabled(),
    };

    return new Response(JSON.stringify(runtimeInfo), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Failed to retrieve runtime information",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

function resolveThreadEndpointInfo(
  runtime: CopilotRuntimeLike,
  threadEndpointsEnabled: boolean,
): RuntimeInfo["threadEndpoints"] {
  const hasRestThreadBackend =
    isIntelligenceRuntime(runtime) ||
    runtime.runner instanceof InMemoryAgentRunner;
  const restEndpointsAvailable = threadEndpointsEnabled && hasRestThreadBackend;
  const managedThreadMetadata =
    threadEndpointsEnabled && isIntelligenceRuntime(runtime);

  return {
    list: restEndpointsAvailable,
    inspect: restEndpointsAvailable,
    mutations: managedThreadMetadata,
    realtimeMetadata: managedThreadMetadata,
  };
}
