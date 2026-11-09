import { telemetry } from ".";
import type { CopilotRuntimeLike } from "../core/runtime";
import type { RuntimeInstanceCreatedInfo } from "./events";

/**
 * Runtimes that already reported `oss.runtime.instance_created`. The event
 * counts runtime instances, so it fires at most once per runtime object, no
 * matter how many handlers are built from that runtime. A WeakSet keeps the
 * guard from holding a discarded runtime in memory.
 *
 * The guard keys on the runtime and not on the process: one process can host
 * several distinct runtimes (multi-tenant servers, tests), and each of those
 * is a real instance. The guard exists for code that builds a handler per
 * request from one long-lived runtime (an old docs snippet did this). Before
 * the guard, that code reported one instance per HTTP request.
 */
const reportedRuntimes = new WeakSet<object>();

/**
 * Fire the `oss.runtime.instance_created` telemetry event for a v2 runtime
 * handler. Called once per handler factory invocation (not per request), and
 * sends at most one event per runtime object (see {@link reportedRuntimes}).
 *
 * v2 does not have a concept of remote endpoints or standalone actions, so
 * those counts are 0 / []. `cloud.api_key_provided` is false at this level
 * because in v2 the cloud public key arrives per-request via the
 * `x-copilotcloud-public-api-key` header — not at handler creation time.
 * See `handlers/handle-run.ts` for the per-request event that DOES carry
 * the key when present.
 *
 * `info` replaces those defaults. The v1 integration wrappers pass the v1
 * payload (endpoint types, actions, the cloud key) here, because they build
 * a v2 handler and must not capture the event a second time themselves.
 *
 * Errors resolving agents are swallowed — telemetry must never break
 * runtime setup.
 */
export function fireInstanceCreatedTelemetry({
  runtime,
  info,
}: {
  runtime: CopilotRuntimeLike;
  info?: RuntimeInstanceCreatedInfo;
}): void {
  if (reportedRuntimes.has(runtime)) return;
  reportedRuntimes.add(runtime);

  const runtimeTelemetry = runtime.telemetry ?? telemetry;

  if (info) {
    runtimeTelemetry.capture("oss.runtime.instance_created", info);
    return;
  }

  // agents can be a static Record, a Promise, or a per-request factory.
  // Factory configs cannot be resolved at handler-creation time (no Request
  // context), so report agentsAmount as null in that case.
  const agentsPromise =
    typeof runtime.agents === "function"
      ? Promise.resolve<Record<string, unknown> | null>(null)
      : Promise.resolve(runtime.agents);

  agentsPromise
    .then((agents) => {
      runtimeTelemetry.capture("oss.runtime.instance_created", {
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
