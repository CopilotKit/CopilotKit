import type { z } from "zod";
import { isPathBinding } from "@copilotkit/shared";
import type {
  GenerativeUIActionBinding,
  GenerativeUIUserEvent,
} from "@copilotkit/shared";
import { GenerativeUIError } from "./errors";
import type { GenerativeUIInvokeResult } from "./errors";
import type { GenerativeUIInvocationOrigin } from "./dispatcher";
import { reportErrorSafely } from "./runtime-context";
import type { GenerativeUIRuntime } from "./runtime-context";
import type { ManagedSurface } from "./surface-manager";

/** One call of an event prop by a component. */
interface EventCall {
  runtime: GenerativeUIRuntime;
  surface: ManagedSurface;
  componentId: string;
  /** The event prop name, for error messages. */
  name: string;
  /**
   * The event `parameters`. When absent, the args go on unchecked. That is
   * the case for a matched event without `parameters`: the function schema
   * checks them.
   */
  parameters?: z.ZodTypeAny;
  args: unknown;
}

/** A `{"@path"}` value read from the surface data model. Others stay. */
function resolveValue(surface: ManagedSurface, value: unknown) {
  return isPathBinding(value)
    ? surface.model.dataModel.get(value["@path"])
    : value;
}

function resolveValues(
  surface: ManagedSurface,
  values: Record<string, unknown> | undefined,
) {
  return Object.fromEntries(
    Object.entries(values ?? {}).map(([key, value]) => [
      key,
      resolveValue(surface, value),
    ]),
  );
}

/**
 * The `userMessage` of an event binding, as text. A `{"@path"}` reads the
 * data model. `undefined` when there is no message, or the value at the path
 * is not a string.
 */
function resolveUserMessage(
  surface: ManagedSurface,
  userMessage: string | { "@path": string } | undefined,
) {
  const value = resolveValue(surface, userMessage);
  return typeof value === "string" ? value : undefined;
}

/**
 * Validates the component's args with the event `parameters`, then runs
 * `send` with them. Never throws: every failure is reported and becomes
 * `{ ok: false, error }`.
 */
async function runEvent(
  call: EventCall,
  send: (
    componentArgs: unknown,
    origin: GenerativeUIInvocationOrigin,
  ) => Promise<GenerativeUIInvokeResult>,
): Promise<GenerativeUIInvokeResult> {
  const { runtime, surface, componentId, name, parameters, args } = call;
  const origin = { surfaceId: surface.surfaceId, componentId };
  try {
    if (!parameters) return await send(args ?? {}, origin);
    const parsed = parameters.safeParse(args ?? {});
    if (!parsed.success) {
      const error = new GenerativeUIError(
        "invalid_event_args",
        `${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ")}`,
      );
      reportErrorSafely(runtime, { kind: "event", ...origin, error });
      return { ok: false, error };
    }
    return await send(parsed.data ?? {}, origin);
  } catch (cause) {
    const error = new GenerativeUIError(
      "event_forward_failed",
      `${name}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    reportErrorSafely(runtime, { kind: "event", ...origin, error });
    return { ok: false, error };
  }
}

/**
 * Runs one call of an event that the model bound: validates the component's
 * args, merges them with the args from the binding (binding literals win),
 * then calls a declared function or forwards an agent event. Never throws.
 */
export function invokeBoundEvent(
  params: EventCall & { binding: GenerativeUIActionBinding },
) {
  const { runtime, surface, binding } = params;
  return runEvent(params, (args, origin) => {
    // ponytail: the args are spread into the call. Args that are not an object are lost, as before.
    const componentArgs = args as Record<string, unknown>;
    if ("functionCall" in binding) {
      return runtime.dispatcher.invoke(
        binding.functionCall["@call"],
        {
          ...componentArgs,
          ...resolveValues(surface, binding.functionCall.args),
        },
        origin,
      );
    }
    const { event } = binding;
    const forwarded: GenerativeUIUserEvent = {
      name: event.name,
      ...origin,
      userMessage: resolveUserMessage(surface, event.userMessage),
      context: { ...componentArgs, ...resolveValues(surface, event.context) },
    };
    return runtime.forwardEvent(forwarded, surface.agentId);
  });
}

/**
 * Runs one call of an event that matches a declared function: validates the
 * component's args with the event `parameters` (if any), then calls the
 * function, which validates them with its own schema. Never throws.
 */
export function invokeMatchedEvent(
  params: EventCall & { functionName: string },
) {
  const { runtime, functionName } = params;
  return runEvent(params, (componentArgs, origin) =>
    runtime.dispatcher.invoke(functionName, componentArgs, origin),
  );
}
