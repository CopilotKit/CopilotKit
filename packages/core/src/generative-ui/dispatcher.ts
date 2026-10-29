import {
  callerProblem,
  functionCallers,
  GENERATIVE_UI_AGENT_FUNCTION_CALLS,
  GENERATIVE_UI_AGENT_FUNCTION_CALLS_OFF_REASON,
  GENERATIVE_UI_FUNCTIONS,
} from "@copilotkit/shared";
import type {
  A2UIFunctionPermissions,
  A2UIFunctionReturnType,
  GenerativeUIFunctionManifest,
  StandardSchemaV1,
} from "@copilotkit/shared";
import { GenerativeUIError } from "@copilotkit/shared/generative-ui";
import type { GenerativeUIInvokeResult } from "@copilotkit/shared/generative-ui";
import { BASIC_FUNCTIONS, ExpressionError } from "./functions";
import { toJsonSchema } from "@copilotkit/shared/generative-ui";

/**
 * A function that generated UI may call, as declared in
 * `createGenerativeUI({ functions })`. Zod schemas fit `parameters`, because
 * they implement Standard Schema.
 */
export interface GenerativeUIDeclaredFunction extends A2UIFunctionPermissions {
  description?: string;
  parameters: StandardSchemaV1;
  returnType?: A2UIFunctionReturnType;
}

/**
 * Holds the latest handler of one mounted `useGenerativeUIFunction`. The hook
 * updates `current` on each render, so it registers only once per mount.
 */
export interface GenerativeUIHandlerRef {
  current: (args: any) => unknown;
}

/** The component of a surface that called a function. */
export interface GenerativeUIInvocationOrigin {
  surfaceId: string;
  componentId: string;
}

/**
 * What called a function: a component of a surface, or the agent with a
 * `callRendererFunction` operation.
 */
export type GenerativeUICallOrigin =
  | GenerativeUIInvocationOrigin
  | { functionCallId: string };

export interface GenerativeUIDispatcher {
  /**
   * Call a declared function with arguments from generated UI or from the
   * agent. Never throws: every failure becomes `{ ok: false, error }`.
   */
  invoke(
    name: string,
    args: unknown,
    origin: GenerativeUICallOrigin,
  ): Promise<GenerativeUIInvokeResult>;
  /** The declared functions that have exactly one mounted handler, as JSON Schema. */
  listExposed(): Record<string, GenerativeUIFunctionManifest>;
  /**
   * Mount a handler for a declared function. Returns the function that
   * unmounts it. Calling the returned function more than once is safe.
   */
  register(name: string, ref: GenerativeUIHandlerRef): () => void;
  /** How many handlers are mounted for `name`, for the inspector. */
  handlerCount(name: string): number;
}

export interface GenerativeUIDispatcherOptions {
  /** The functions declared in `createGenerativeUI({ functions })`, read at call time. */
  getDeclared: () => ReadonlyMap<string, GenerativeUIDeclaredFunction>;
  /** Called for each failed `invoke`. A throw from it is ignored. */
  onError?: (info: {
    name: string;
    origin: GenerativeUICallOrigin;
    error: GenerativeUIError;
  }) => void;
}

type Resolved =
  | {
      ok: true;
      declared: GenerativeUIDeclaredFunction;
      ref: GenerativeUIHandlerRef;
    }
  | { ok: false; error: GenerativeUIError };

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Creates the registry of functions that generated UI may call.
 *
 * A function is callable when it is declared in `getDeclared()` and exactly
 * one handler is mounted for it with `register`. Names are resolved at call
 * time and fail closed. Nothing is sent to the agent.
 * Neither `invoke` nor `listExposed` throws.
 *
 * @param options.getDeclared - Returns the declared functions.
 * @param options.onError - Gets each failed call.
 *
 * @example
 * ```ts
 * const dispatcher = createGenerativeUIDispatcher({
 *   getDeclared: () => new Map(Object.entries(ui.functions)),
 * });
 * const unregister = dispatcher.register("addToCart", handlerRef);
 * await dispatcher.invoke("addToCart", { productId: "p1" }, origin);
 * unregister();
 * ```
 */
/**
 * True while the browser counts the current task as user-activated (a
 * click, a key press). Where the API is missing (older browsers, test
 * environments), the gesture is assumed.
 */
function hasUserActivation() {
  if (typeof navigator === "undefined") return true;
  const activation = (
    navigator as Navigator & {
      userActivation?: { isActive: boolean };
    }
  ).userActivation;
  return activation === undefined || activation.isActive;
}

/**
 * The permissions of a declared function as the manifest states them: the
 * callers always written out, so a reader needs no default.
 */
function permissionsOf(fn: A2UIFunctionPermissions) {
  const callers = functionCallers(fn);
  return {
    allowedCallers:
      callers.renderer && callers.agent
        ? ("rendererOrAgent" as const)
        : callers.agent
          ? ("agentOnly" as const)
          : ("rendererOnly" as const),
    ...(fn.requiresUserActivation ? { requiresUserActivation: true } : {}),
  };
}

export function createGenerativeUIDispatcher(
  options: GenerativeUIDispatcherOptions,
) {
  const handlers = new Map<string, Set<GenerativeUIHandlerRef>>();

  const resolveUnchecked = (name: string): Resolved => {
    const declared = options.getDeclared().get(name);
    if (!declared) {
      return {
        ok: false,
        error: new GenerativeUIError(
          "function_not_found",
          `No generative UI function named "${name}" is declared in createGenerativeUI({ functions })`,
        ),
      };
    }
    const mounted = [...(handlers.get(name) ?? [])];
    const [ref] = mounted;
    if (!ref) {
      return {
        ok: false,
        error: new GenerativeUIError(
          "function_not_found",
          `"${name}" is declared, but no useGenerativeUIFunction handler is mounted for it`,
        ),
      };
    }
    if (mounted.length > 1) {
      return {
        ok: false,
        error: new GenerativeUIError(
          "function_conflict",
          `"${name}" has ${mounted.length} useGenerativeUIFunction handlers mounted. Mount exactly one.`,
        ),
      };
    }
    return { ok: true, declared, ref };
  };

  const isDeclared = (name: string) => {
    try {
      return options.getDeclared().has(name);
    } catch {
      return false;
    }
  };

  // getDeclared is outside code; a throw here becomes a result, not a rejection.
  const resolve = (name: string): Resolved => {
    try {
      return resolveUnchecked(name);
    } catch (error) {
      return {
        ok: false,
        error: new GenerativeUIError(
          "handler_failed",
          `"${name}" could not be resolved: ${messageOf(error)}`,
        ),
      };
    }
  };

  const validateArgs = async (
    name: string,
    schema: StandardSchemaV1,
    args: unknown,
  ): Promise<
    { ok: true; value: unknown } | { ok: false; error: GenerativeUIError }
  > => {
    try {
      const validation = await schema["~standard"].validate(args);
      if (!validation.issues) return { ok: true, value: validation.value };
      const detail = validation.issues
        .map(
          (i) =>
            `${(i.path ?? []).map((p) => (typeof p === "object" ? p.key : p)).join(".") || "args"}: ${i.message}`,
        )
        .join("; ");
      return {
        ok: false,
        error: new GenerativeUIError(
          "invalid_arguments",
          `Invalid arguments for "${name}": ${detail}`,
        ),
      };
    } catch (error) {
      // A schema transform or refinement that throws is a rejection of the arguments.
      return {
        ok: false,
        error: new GenerativeUIError(
          "invalid_arguments",
          `Invalid arguments for "${name}": ${messageOf(error)}`,
        ),
      };
    }
  };

  const failWith = (
    name: string,
    origin: GenerativeUICallOrigin,
    error: GenerativeUIError,
  ): GenerativeUIInvokeResult => {
    try {
      options.onError?.({ name, origin, error });
    } catch {
      // A throwing onError must not turn a failed call into a rejection.
    }
    return { ok: false, error };
  };

  /**
   * Why `origin` may not call a function with these permissions now, as an
   * error, or `undefined` when it may. The agent is refused what is for the
   * renderer; a component is refused what is for the agent, and a gesture
   * function when the browser counts no user activation.
   */
  const callerError = (
    name: string,
    fn: A2UIFunctionPermissions,
    origin: GenerativeUICallOrigin,
  ) => {
    const isComponent = "componentId" in origin;
    if (!isComponent && !GENERATIVE_UI_AGENT_FUNCTION_CALLS) {
      return new GenerativeUIError(
        "invalid_function_call",
        GENERATIVE_UI_AGENT_FUNCTION_CALLS_OFF_REASON,
      );
    }
    const problem = callerProblem(name, fn, isComponent ? "renderer" : "agent");
    if (problem !== undefined) {
      return new GenerativeUIError("invalid_function_call", problem);
    }
    // A component event is not always a gesture: onVisible fires from an
    // IntersectionObserver. Browsers track activation themselves.
    if (isComponent && fn.requiresUserActivation && !hasUserActivation()) {
      return new GenerativeUIError(
        "invalid_function_call",
        `function "${name}" runs only from a user gesture; this event was not one`,
      );
    }
    return undefined;
  };

  /**
   * Runs a basic function of the A2UI catalog. They are value functions of
   * the renderer: the agent cannot call them, and one that needs a user
   * gesture runs only from an event binding.
   */
  const invokeBasic = (
    name: string,
    args: unknown,
    origin: GenerativeUICallOrigin,
  ): GenerativeUIInvokeResult => {
    const info = GENERATIVE_UI_FUNCTIONS[name];
    const run = BASIC_FUNCTIONS[name];
    if (!info || !run) {
      return failWith(
        name,
        origin,
        new GenerativeUIError(
          "function_not_found",
          `"${name}" is not a basic function`,
        ),
      );
    }
    const refused = callerError(name, info, origin);
    if (refused) return failWith(name, origin, refused);
    const isObject =
      typeof args === "object" && args !== null && !Array.isArray(args);
    if (args !== undefined && !isObject) {
      return failWith(
        name,
        origin,
        new GenerativeUIError(
          "invalid_arguments",
          `Invalid arguments for "${name}": args must be an object`,
        ),
      );
    }
    try {
      return {
        ok: true,
        result: run((args ?? {}) as Record<string, unknown>),
      };
    } catch (error) {
      return failWith(
        name,
        origin,
        new GenerativeUIError(
          error instanceof ExpressionError
            ? "invalid_arguments"
            : "handler_failed",
          `"${name}" failed: ${messageOf(error)}`,
        ),
      );
    }
  };

  const dispatcher: GenerativeUIDispatcher = {
    async invoke(name, args, origin) {
      const resolved = resolve(name);
      // A declared function wins over a basic one of the same name, also
      // while its handler is not mounted: that is an error of the app, not
      // a call of the basic function.
      if (
        !resolved.ok &&
        resolved.error.code === "function_not_found" &&
        !isDeclared(name) &&
        Object.prototype.hasOwnProperty.call(BASIC_FUNCTIONS, name)
      ) {
        return invokeBasic(name, args, origin);
      }
      if (!resolved.ok) return failWith(name, origin, resolved.error);
      const refused = callerError(name, resolved.declared, origin);
      if (refused) return failWith(name, origin, refused);
      const validated = await validateArgs(
        name,
        resolved.declared.parameters,
        args ?? {},
      );
      if (!validated.ok) return failWith(name, origin, validated.error);
      try {
        // Read `current` now, so the latest handler runs.
        return {
          ok: true,
          result: await resolved.ref.current(validated.value),
        };
      } catch (error) {
        return failWith(
          name,
          origin,
          new GenerativeUIError(
            "handler_failed",
            `"${name}" failed: ${messageOf(error)}`,
          ),
        );
      }
    },

    listExposed() {
      let names: string[];
      try {
        names = [...options.getDeclared().keys()];
      } catch {
        // If the declared functions cannot be read, advertise nothing.
        return {};
      }
      // Advertise exactly the names invoke would accept. While the agent
      // path is off, a function for the agent only has no caller at all.
      const listed: Record<string, GenerativeUIFunctionManifest> = {};
      for (const name of names) {
        const resolved = resolve(name);
        if (!resolved.ok) continue;
        const isAgentOnly = !functionCallers(resolved.declared).renderer;
        if (isAgentOnly && !GENERATIVE_UI_AGENT_FUNCTION_CALLS) continue;
        const { description, parameters, returnType } = resolved.declared;
        try {
          listed[name] = {
            ...(description ? { description } : {}),
            parameters: toJsonSchema(parameters),
            ...(returnType ? { returnType } : {}),
            ...permissionsOf(resolved.declared),
          };
        } catch {
          // A schema that cannot be converted to JSON Schema is not advertised.
        }
      }
      return listed;
    },

    register(name, ref) {
      const mounted = handlers.get(name) ?? new Set<GenerativeUIHandlerRef>();
      mounted.add(ref);
      handlers.set(name, mounted);
      // An empty set stays in the map. It resolves as "no handler mounted".
      return () => {
        mounted.delete(ref);
      };
    },

    handlerCount: (name) => handlers.get(name)?.size ?? 0,
  };
  return dispatcher;
}
