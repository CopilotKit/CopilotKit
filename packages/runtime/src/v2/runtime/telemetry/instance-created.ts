import { telemetry } from ".";
import type { CopilotRuntimeLike } from "../core/runtime";

/**
 * Fire the `oss.runtime.instance_created` telemetry event for a v2 runtime
 * handler. Called once per handler factory invocation (not per request).
 *
 * Sets `runtime.framework` as a global property so every subsequent event
 * from this process is tagged with the adapter that created the handler.
 *
 * v2 does not have a concept of remote endpoints or standalone actions, so
 * those counts are 0 / []. `cloud.api_key_provided` is false at this level
 * because in v2 the cloud public key arrives per-request via the
 * `x-copilotcloud-public-api-key` header — not at handler creation time.
 * See `handlers/handle-run.ts` for the per-request event that DOES carry
 * the key when present.
 *
 * Errors resolving agents are swallowed — telemetry must never break
 * runtime setup.
 */
export function fireInstanceCreatedTelemetry({
  runtime,
  framework,
}: {
  runtime: CopilotRuntimeLike;
  framework: string;
}): void {
  telemetry.setGlobalProperties({ runtime: { framework } });

  // agents can be a static Record, a Promise, or a per-request factory.
  // Factory configs cannot be resolved at handler-creation time (no Request
  // context), so report agentsAmount as null in that case.
  const agentsPromise =
    typeof runtime.agents === "function"
      ? Promise.resolve<Record<string, unknown> | null>(null)
      : Promise.resolve(runtime.agents);

  agentsPromise
    .then((agents) => {
      telemetry.capture("oss.runtime.instance_created", {
        actionsAmount: 0,
        endpointTypes: [],
        endpointsAmount: 0,
        agentsAmount: agents ? Object.keys(agents).length : null,
        "cloud.api_key_provided": false,
      });
    })
    .catch(() => {
      // Swallow — telemetry must not break runtime creation.
    });
}
