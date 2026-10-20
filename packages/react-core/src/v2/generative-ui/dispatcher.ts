import type {
  GenerativeUIFunctionManifest,
  StandardSchemaV1,
} from "@copilotkit/shared";
import { GenerativeUIError } from "./errors";
import type { GenerativeUIInvokeResult } from "./errors";
import { toJsonSchema } from "./json-schema";

/**
 * A function that generated UI may call, as declared in
 * `createGenerativeUI({ functions })`. Zod schemas fit `parameters`, because
 * they implement Standard Schema.
 */
export interface GenerativeUIDeclaredFunction {
  description?: string;
  parameters: StandardSchemaV1;
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

  const dispatcher: GenerativeUIDispatcher = {
    async invoke(name, args, origin) {
      const resolved = resolve(name);
      if (!resolved.ok) return failWith(name, origin, resolved.error);
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
      // Advertise exactly the names invoke would accept.
      const listed: Record<string, GenerativeUIFunctionManifest> = {};
      for (const name of names) {
        const resolved = resolve(name);
        if (!resolved.ok) continue;
        const { description, parameters } = resolved.declared;
        try {
          listed[name] = {
            ...(description ? { description } : {}),
            parameters: toJsonSchema(parameters),
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
