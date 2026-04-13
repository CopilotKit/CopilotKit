import {
  CopilotRuntimeLike,
  isIntelligenceRuntime,
  resolveAgents,
} from "../core/runtime";
import {
  AgentDescription,
  RuntimeInfo,
  type RuntimeLicenseStatus,
} from "@copilotkit/shared";
import { VERSION } from "../core/runtime";

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
}

export async function handleGetRuntimeInfo({
  runtime,
  request,
}: HandleGetRuntimeInfoParameters) {
  try {
    const agents = await resolveAgents(runtime.agents, request);

    const agentsDict = Object.entries(agents).reduce(
      (acc, [name, agent]) => {
        acc[name] = {
          name,
          description: agent.description,
          className: agent.constructor.name,
        };
        return acc;
      },
      {} as Record<string, AgentDescription>,
    );

    const runtimeInfo: RuntimeInfo = {
      version: VERSION,
      agents: agentsDict,
      audioFileTranscriptionEnabled: !!runtime.transcriptionService,
      mode: runtime.mode,
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
