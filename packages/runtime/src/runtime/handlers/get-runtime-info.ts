import { getRuntimeLogger } from "../core/logger";
import type { AgentCapabilities } from "@ag-ui/core";
import type { CopilotKitRuntimeLike } from "../core/runtime";
import { hasLearningContainerConfiguration } from "../core/learning";
import { isIntelligenceRuntime, resolveAgents } from "../core/runtime";
import type {
  AgentDescription,
  GenerativeUIRuntimeInfo,
  RuntimeInfo,
  RuntimeEntitlementResponse,
  ThreadEndpointRuntimeInfo,
} from "@copilotkit/shared";
import type { RuntimeLicenseStatus } from "@copilotkit/shared";
import type { LicenseChecker } from "@copilotkit/license-verifier";
import { VERSION } from "../core/runtime";
import { PlatformRequestError } from "../intelligence-platform/client";
import { isTelemetryDisabled } from "../telemetry/telemetry-client";
import { supportsLocalThreadEndpoints } from "../runner/agent-runner";
import { isThreadOperationAvailable } from "./shared/thread-access";

function resolveLicenseStatus(
  licenseChecker: LicenseChecker | undefined,
): RuntimeLicenseStatus {
  if (!licenseChecker) return "none";
  const status = licenseChecker.getStatus();
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
  licenseChecker: LicenseChecker | undefined,
  runtimeEntitlements: RuntimeEntitlementResponse | undefined,
): RuntimeLicenseStatus {
  if (runtimeEntitlements?.status === "ready") {
    if (
      runtimeEntitlements.entitlement.source === "managedOrgSubscription" ||
      runtimeEntitlements.entitlement.source ===
        "awsMarketplaceDeploymentLicense"
    ) {
      return runtimeEntitlements.entitlement.active ? "valid" : "none";
    }

    if (runtimeEntitlements.entitlement.active) {
      return "valid";
    }
  }

  const legacyLicenseStatus = resolveLicenseStatus(licenseChecker);
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
  runtime: CopilotKitRuntimeLike;
  request: Request;
  threadEndpointsEnabled?: boolean;
  singleRouteResourceOperationsEnabled?: boolean;
}

/**
 * Resolve structured Runtime entitlements for configured Intelligence runtimes.
 *
 * Dependency failures are deliberately converted to a stable unavailable
 * diagnostic so `/info` remains an availability endpoint. The underlying
 * error is not exposed because it may contain upstream response details.
 */
async function resolveRuntimeEntitlements(
  runtime: CopilotKitRuntimeLike,
): Promise<RuntimeEntitlementResponse | undefined> {
  if (!isIntelligenceRuntime(runtime)) {
    return undefined;
  }

  try {
    return await runtime.intelligence.getRuntimeEntitlements();
  } catch (error) {
    if (error instanceof PlatformRequestError && error.retryable === false) {
      return {
        status: "misconfigured",
        error: {
          code: "runtime_entitlements_misconfigured",
          message: "Runtime entitlement lookup is misconfigured",
          retryable: false,
        },
      };
    }

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
  singleRouteResourceOperationsEnabled = false,
}: HandleGetRuntimeInfoParameters) {
  try {
    const runtimeEntitlementsPromise = resolveRuntimeEntitlements(runtime);
    const webEnabled =
      !isIntelligenceRuntime(runtime) || runtime.identifyUser !== undefined;
    const agents = webEnabled
      ? await resolveAgents(runtime.agents, request)
      : {};

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
          getRuntimeLogger(runtime).warn(
            { err: error, agentId: name },
            `Failed to fetch capabilities for agent "${name}"`,
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
    const runtimeEntitlements = await runtimeEntitlementsPromise;
    // Verified on first use, not at construction (see getLicenseChecker).
    const licenseChecker = isIntelligenceRuntime(runtime)
      ? await runtime.getLicenseChecker?.()
      : undefined;

    const runtimeInfo: RuntimeInfo = {
      version: VERSION,
      agents: agentsDict,
      audioFileTranscriptionEnabled:
        webEnabled && !!runtime.transcriptionService,
      mode: runtime.mode,
      threadEndpoints: resolveThreadEndpointInfo(
        runtime,
        threadEndpointsEnabled && webEnabled,
      ),
      ...(singleRouteResourceOperationsEnabled
        ? {
            singleRoute: {
              resourceOperations: true,
              threadEndpoints: resolveThreadEndpointInfo(runtime, webEnabled),
            },
          }
        : {}),
      // Advertised unconditionally. Multi-route runtimes expose the dedicated
      // POST /agent/:agentId/suggest path; single-route clients fall back to a
      // client-side run (they don't construct the single-route envelope for
      // suggest). The flag lets multi-route clients detect the stateless path.
      suggestions: webEnabled,
      ...(isIntelligenceRuntime(runtime) && webEnabled
        ? {
            intelligence: {
              wsUrl: runtime.intelligence.ɵgetClientWsUrl(),
            },
            inspectorMetadata: true,
            ...(hasLearningContainerConfiguration(runtime)
              ? { inspectorLearning: true }
              : {}),
          }
        : {}),
      openGenerativeUIEnabled: webEnabled && !!runtime.openGenerativeUI,
      generativeUI: resolveGenerativeUIInfo(runtime, webEnabled),
      ...(isIntelligenceRuntime(runtime)
        ? {
            licenseStatus: resolveCompatibilityLicenseStatus(
              licenseChecker,
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

/**
 * Report generative UI with the rules `configureAgentForRequest` uses to
 * attach the generative UI middlewares: it is on unless `generativeUI` is
 * `false`, and `{ agents }` limits it to those agents. The A2UI version of an
 * agent (`a2uiVersion`) does not change it: the client renders 1.0 for both,
 * as the runtime converts v0.9 surfaces. When the option is omitted, the
 * middlewares run only for a client that asks for them, so the client can
 * still turn generative UI on.
 */
function resolveGenerativeUIInfo(
  runtime: CopilotKitRuntimeLike,
  webEnabled: boolean,
): GenerativeUIRuntimeInfo {
  const generativeUI = runtime.generativeUI;
  if (!webEnabled || generativeUI === false) return { enabled: false };
  const agents =
    typeof generativeUI === "object" ? generativeUI.agents : undefined;
  return { enabled: true, ...(agents ? { agents } : {}) };
}

function resolveThreadEndpointInfo(
  runtime: CopilotKitRuntimeLike,
  threadEndpointsEnabled: boolean,
): ThreadEndpointRuntimeInfo {
  // A local route is advertised only when the Thread access policy lets it
  // serve requests: without identity, list is refused by default while
  // reading a Thread by id is not.
  const available = (operation: "list" | "read") =>
    threadEndpointsEnabled &&
    (isIntelligenceRuntime(runtime) ||
      (supportsLocalThreadEndpoints(runtime.runner) &&
        isThreadOperationAvailable(runtime, operation)));
  const managedThreadMetadata =
    threadEndpointsEnabled && isIntelligenceRuntime(runtime);

  return {
    list: available("list"),
    inspect: available("read"),
    mutations: managedThreadMetadata,
    realtimeMetadata: managedThreadMetadata,
  };
}
