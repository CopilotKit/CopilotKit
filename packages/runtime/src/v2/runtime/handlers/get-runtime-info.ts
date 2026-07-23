import type { AgentCapabilities } from "@ag-ui/core";
import type { CopilotRuntimeLike } from "../core/runtime";
import {
  isA2UIEnabled,
  isIntelligenceRuntime,
  resolveAgents,
} from "../core/runtime";
import type {
  AgentDescription,
  RuntimeInfo,
  RuntimeEntitlementResponse,
  ThreadEndpointRuntimeInfo,
} from "@copilotkit/shared";
import type { RuntimeLicenseStatus } from "@copilotkit/shared";
import { VERSION } from "../core/runtime";
import { isTelemetryDisabled } from "../telemetry/telemetry-client";
import { supportsLocalThreadEndpoints } from "../runner/agent-runner";

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

/**
 * Map the structured entitlement authority onto the legacy status consumed by
 * older Core, React, and Angular thread surfaces. A ready managed entitlement
 * is authoritative in both directions. Otherwise, preserve the legacy
 * self-hosted license fallback. A retryable lookup without that fallback
 * remains unknown until it resolves.
 */
function resolveCompatibilityLicenseStatus(
  runtime: CopilotRuntimeLike,
  runtimeEntitlements: RuntimeEntitlementResponse | undefined,
): RuntimeLicenseStatus {
  if (runtimeEntitlements?.status === "ready") {
    if (runtimeEntitlements.entitlement.source === "managedOrgSubscription") {
      return runtimeEntitlements.entitlement.active ? "valid" : "none";
    }

    if (runtimeEntitlements.entitlement.active) {
      return "valid";
    }
  }

  const legacyLicenseStatus = resolveLicenseStatus(runtime);
  if (
    legacyLicenseStatus === "none" &&
    runtimeEntitlements?.status !== "ready" &&
    runtimeEntitlements?.error.retryable
  ) {
    return "unknown";
  }

  return legacyLicenseStatus;
}

interface HandleGetRuntimeInfoParameters {
  runtime: CopilotRuntimeLike;
  request: Request;
  threadEndpointsEnabled?: boolean;
}

/**
 * Resolve structured Runtime entitlements for configured Intelligence runtimes.
 *
 * Dependency failures are deliberately converted to a stable unavailable
 * diagnostic so `/info` remains an availability endpoint. The underlying
 * error is not exposed because it may contain upstream response details.
 */
async function resolveRuntimeEntitlements(
  runtime: CopilotRuntimeLike,
): Promise<RuntimeEntitlementResponse | undefined> {
  if (!isIntelligenceRuntime(runtime)) {
    return undefined;
  }

  try {
    return await runtime.intelligence.getRuntimeEntitlements();
  } catch {
    return {
      status: "unavailable",
      error: {
        code: "runtime_entitlements_unavailable",
        message: "Runtime entitlement lookup failed",
        retryable: true,
      },
    };
  }
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
    const runtimeEntitlements = await resolveRuntimeEntitlements(runtime);

    const runtimeInfo: RuntimeInfo = {
      version: VERSION,
      agents: agentsDict,
      audioFileTranscriptionEnabled: !!runtime.transcriptionService,
      mode: runtime.mode,
      threadEndpoints: resolveThreadEndpointInfo(
        runtime,
        threadEndpointsEnabled,
      ),
      // Advertised unconditionally. Multi-route runtimes expose the dedicated
      // POST /agent/:agentId/suggest path; single-route clients fall back to a
      // client-side run (they don't construct the single-route envelope for
      // suggest). The flag lets multi-route clients detect the stateless path.
      suggestions: true,
      ...(isIntelligenceRuntime(runtime)
        ? {
            intelligence: {
              wsUrl: runtime.intelligence.ɵgetClientWsUrl(),
            },
          }
        : {}),
      // Legacy flat flag, kept for older clients. The `a2ui` object below is
      // the source of truth: it preserves the per-agent scoping that this
      // boolean discards (see CopilotKit/CopilotKit#5369). Both go through the
      // shared isA2UIEnabled() predicate so an explicit `enabled: false`
      // disables a2ui here exactly as it does on the run path.
      a2uiEnabled: isA2UIEnabled(runtime.a2ui),
      ...(isA2UIEnabled(runtime.a2ui)
        ? {
            a2ui: {
              enabled: true,
              ...(runtime.a2ui.agents ? { agents: runtime.a2ui.agents } : {}),
            },
          }
        : {}),
      openGenerativeUIEnabled: !!runtime.openGenerativeUI,
      ...(isIntelligenceRuntime(runtime)
        ? {
            licenseStatus: resolveCompatibilityLicenseStatus(
              runtime,
              runtimeEntitlements,
            ),
          }
        : {}),
      ...(runtimeEntitlements ? { runtimeEntitlements } : {}),
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
): ThreadEndpointRuntimeInfo {
  const hasRestThreadBackend =
    isIntelligenceRuntime(runtime) ||
    supportsLocalThreadEndpoints(runtime.runner);
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
