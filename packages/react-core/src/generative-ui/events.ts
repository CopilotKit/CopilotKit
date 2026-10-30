import type {
  GenerativeUIActionBinding,
  GenerativeUIUserEvent,
} from "@copilotkit/shared";
import { GenerativeUIError } from "./errors";
import { resolveDynamicValue } from "./resolve";
import type { ResolveContext } from "./resolve";
import type { GenerativeUIInvokeResult } from "./errors";
import type { GenerativeUIInvocationOrigin } from "./dispatcher";
import { reportErrorSafely } from "./runtime-context";
import type { GenerativeUIRuntime } from "./runtime-context";
import { formatIssues, validateSchema } from "./schema";
import type { GenerativeUISchema } from "./schema";
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
  parameters?: GenerativeUISchema;
  args: unknown;
}

/**
 * The context of a running event binding: it reads the surface data model
 * and resolves relative paths against the template item of the component.
 * A function that needs a user gesture (openUrl) is not a value here
 * either; it runs through the dispatcher as the binding's functionCall.
 */
function eventContext(
  surface: ManagedSurface,
  basePath: string | undefined,
): ResolveContext {
  return { data: surface.model.dataModel, basePath };
}

/**
 * A value of an event binding with its dynamic values resolved: `{"@path"}`
 * bindings and function values, at any depth.
 */
function resolveValue(
  surface: ManagedSurface,
  basePath: string | undefined,
  value: unknown,
) {
  return resolveDynamicValue(value, eventContext(surface, basePath)).value;
}

/**
 * The entries of an args or context record, each resolved on its own. The
 * record is not resolved as a whole, because a record with one `event` or
 * `functionCall` key would look like an action binding and stay as it is.
 */
function resolveValues(
  surface: ManagedSurface,
  basePath: string | undefined,
  values: Record<string, unknown> | undefined,
) {
  return Object.fromEntries(
    Object.entries(values ?? {}).map(([key, value]) => [
      key,
      resolveValue(surface, basePath, value),
    ]),
  );
}

/**
 * The `userMessage` of an event binding, as text. A `{"@path"}` or a
 * function value is resolved. `undefined` when there is no message, or
 * the value is not a string.
 */
function resolveUserMessage(
  surface: ManagedSurface,
  basePath: string | undefined,
  userMessage: unknown,
) {
  const value = resolveValue(surface, basePath, userMessage);
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
    // A schema that validates synchronously sends in the same tick.
    const result = validateSchema(parameters, args ?? {});
    const parsed = result instanceof Promise ? await result : result;
    if (!parsed.success) {
      const error = new GenerativeUIError(
        "invalid_event_args",
        `${name}: ${formatIssues(parsed.issues, "args")}`,
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
  params: EventCall & {
    binding: GenerativeUIActionBinding;
    /** The template item path of the component, for relative paths. */
    basePath: string | undefined;
  },
) {
  const { runtime, surface, binding, basePath } = params;
  return runEvent(params, (args, origin) => {
    // ponytail: the args are spread into the call. Args that are not an object are lost, as before.
    const componentArgs = args as Record<string, unknown>;
    if ("functionCall" in binding) {
      return runtime.dispatcher.invoke(
        binding.functionCall["@call"],
        {
          ...componentArgs,
          ...resolveValues(surface, basePath, binding.functionCall.args),
        },
        origin,
      );
    }
    const { event } = binding;
    const forwarded: GenerativeUIUserEvent = {
      name: event.name,
      ...origin,
      timestamp: new Date().toISOString(),
      userMessage: resolveUserMessage(surface, basePath, event.userMessage),
      context: {
        ...componentArgs,
        ...resolveValues(surface, basePath, event.context),
      },
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
