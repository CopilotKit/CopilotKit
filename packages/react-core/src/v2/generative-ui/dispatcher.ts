import type { FrontendTool } from "@copilotkit/core";
import { randomUUID } from "@copilotkit/shared";
import type {
  GenerativeUIFunctionManifest,
  StandardSchemaV1,
} from "@copilotkit/shared";
import { GenerativeUIError } from "./errors";
import type { GenerativeUIInvokeResult } from "./errors";
import { toJsonSchema } from "./json-schema";

export interface GenerativeUIFunctionDefinition<T = any> {
  description?: string;
  parameters?: StandardSchemaV1<any, T>;
  handler: (args: T) => unknown | Promise<unknown>;
}

export interface GenerativeUIInvocationOrigin {
  surfaceId: string;
  componentId: string;
}

export interface GenerativeUIDispatcher {
  invoke(
    name: string,
    args: unknown,
    origin: GenerativeUIInvocationOrigin,
  ): Promise<GenerativeUIInvokeResult>;
  listExposed(): Record<string, GenerativeUIFunctionManifest>;
}

export interface GenerativeUIDispatcherSources {
  getProviderFunctions: () =>
    | Record<string, GenerativeUIFunctionDefinition>
    | undefined;
  getTool: (name: string) => FrontendTool<any> | undefined;
  listTools: () => readonly FrontendTool<any>[];
  /**
   * Runtime toggle for tools (e.g. `copilotkit.setToolEnabled(name, false)`).
   * Returning false for an exposed tool makes it fail closed and omits it from `listExposed`.
   */
  isToolEnabled?: (name: string) => boolean;
  onError?: (info: {
    name: string;
    origin: GenerativeUIInvocationOrigin;
    error: GenerativeUIError;
  }) => void;
}

type Resolved =
  | {
      ok: true;
      description?: string;
      parameters?: StandardSchemaV1;
      run: (args: unknown) => unknown;
    }
  | { ok: false; error: GenerativeUIError };

const EMPTY_OBJECT_SCHEMA = { type: "object", properties: {} };

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * One registry for functions generated UI may call: provider-level
 * `generativeUI.functions` and `useFrontendTool({ exposeToGenerativeUI: true })`.
 * Resolution happens at call time and fails closed; nothing is forwarded to the agent.
 * Neither `invoke` nor `listExposed` throws: user code that throws becomes a result.
 */
export function createGenerativeUIDispatcher(
  sources: GenerativeUIDispatcherSources,
): GenerativeUIDispatcher {
  const resolveUnchecked = (name: string): Resolved => {
    const providerFunction = sources.getProviderFunctions()?.[name];
    const tool = sources.getTool(name);
    const exposedTool = tool?.exposeToGenerativeUI ? tool : undefined;
    if (providerFunction && exposedTool) {
      return {
        ok: false,
        error: new GenerativeUIError(
          "function_conflict",
          `"${name}" is registered both in generativeUI.functions and by useFrontendTool({ exposeToGenerativeUI: true })`,
        ),
      };
    }
    if (providerFunction) {
      return {
        ok: true,
        description: providerFunction.description,
        parameters: providerFunction.parameters,
        run: providerFunction.handler,
      };
    }
    if (exposedTool) {
      const handler = exposedTool.handler;
      if (
        exposedTool.available === false ||
        !handler ||
        sources.isToolEnabled?.(name) === false
      ) {
        return {
          ok: false,
          error: new GenerativeUIError(
            "function_not_exposed",
            `"${name}" is currently disabled`,
          ),
        };
      }
      return {
        ok: true,
        description: exposedTool.description,
        parameters: exposedTool.parameters,
        run: (args) =>
          handler(args as Record<string, unknown>, {
            toolCall: {
              id: `genui-${randomUUID()}`,
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            },
          }),
      };
    }
    if (tool) {
      return {
        ok: false,
        error: new GenerativeUIError(
          "function_not_exposed",
          `"${name}" is a frontend tool but is not exposed to generative UI (set exposeToGenerativeUI: true)`,
        ),
      };
    }
    return {
      ok: false,
      error: new GenerativeUIError(
        "function_not_found",
        `No generative UI function named "${name}"`,
      ),
    };
  };

  // Source getters are user code too; a throw here becomes a result, not a rejection.
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
    origin: GenerativeUIInvocationOrigin,
    error: GenerativeUIError,
  ): GenerativeUIInvokeResult => {
    try {
      sources.onError?.({ name, origin, error });
    } catch {
      // A throwing onError must not turn a failed call into a rejection.
    }
    return { ok: false, error };
  };

  return {
    async invoke(name, args, origin) {
      const resolved = resolve(name);
      if (!resolved.ok) return failWith(name, origin, resolved.error);
      let value: unknown = args ?? {};
      if (resolved.parameters) {
        const validated = await validateArgs(name, resolved.parameters, value);
        if (!validated.ok) return failWith(name, origin, validated.error);
        value = validated.value;
      }
      try {
        return { ok: true, result: await resolved.run(value) };
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
        const providerNames = Object.keys(sources.getProviderFunctions() ?? {});
        const toolNames = sources
          .listTools()
          .filter((tool) => tool.exposeToGenerativeUI)
          .map((tool) => tool.name);
        names = [...new Set([...providerNames, ...toolNames])];
      } catch {
        // An unreadable registry advertises nothing.
        return {};
      }
      // Advertise exactly the names invoke would accept.
      const listed: Record<string, GenerativeUIFunctionManifest> = {};
      for (const name of names) {
        const resolved = resolve(name);
        if (!resolved.ok) continue;
        try {
          listed[name] = {
            ...(resolved.description
              ? { description: resolved.description }
              : {}),
            parameters: resolved.parameters
              ? toJsonSchema(resolved.parameters)
              : EMPTY_OBJECT_SCHEMA,
          };
        } catch {
          // A schema that cannot be converted to JSON Schema is not advertised.
        }
      }
      return listed;
    },
  };
}
