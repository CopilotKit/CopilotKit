import type { z } from "zod";
import { isPathBinding } from "@copilotkit/shared";
import type { GenerativeUIActionBinding } from "@copilotkit/shared";
import { GenerativeUIError } from "./errors";
import type { GenerativeUIInvokeResult } from "./errors";
import { reportErrorSafely } from "./runtime-context";
import type { GenerativeUIRuntime } from "./runtime-context";
import type { ManagedSurface } from "./surface-manager";

function resolveValues(
  surface: ManagedSurface,
  values: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values ?? {}).map(([key, value]) => [
      key,
      isPathBinding(value) ? surface.model.dataModel.get(value.path) : value,
    ]),
  );
}

/**
 * Runs one event-prop call: validates the component's args, merges them with
 * the agent-declared args (agent literals win), then dispatches a function
 * call or forwards an agent event. Never throws.
 */
export async function invokeBoundEvent(params: {
  runtime: GenerativeUIRuntime;
  surface: ManagedSurface;
  componentId: string;
  name: string;
  parameters: z.ZodTypeAny;
  binding: GenerativeUIActionBinding;
  args: unknown;
}): Promise<GenerativeUIInvokeResult> {
  const { runtime, surface, componentId, name, parameters, binding, args } =
    params;
  const origin = { surfaceId: surface.surfaceId, componentId };
  try {
    const parsed = parameters.safeParse(args ?? {});
    if (!parsed.success) {
      const error = new GenerativeUIError(
        "invalid_event_args",
        `${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ")}`,
      );
      reportErrorSafely(runtime, { kind: "event", ...origin, error });
      return { ok: false, error };
    }
    const componentArgs = (parsed.data ?? {}) as Record<string, unknown>;
    if ("functionCall" in binding) {
      return await runtime.dispatcher.invoke(
        binding.functionCall.call,
        {
          ...componentArgs,
          ...resolveValues(surface, binding.functionCall.args),
        },
        origin,
      );
    }
    return await runtime.forwardEvent(
      {
        name: binding.event.name,
        ...origin,
        context: {
          ...componentArgs,
          ...resolveValues(surface, binding.event.context),
        },
      },
      surface.agentId,
    );
  } catch (cause) {
    const error = new GenerativeUIError(
      "event_forward_failed",
      `${name}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    reportErrorSafely(runtime, { kind: "event", ...origin, error });
    return { ok: false, error };
  }
}
