import type { ToolCall } from "@ag-ui/client";
import { logger, randomUUID } from "@copilotkit/shared";
import type { FrontendTool, WebMCPToolAnnotations } from "../types";
import { createToolSchema } from "./tool-schema";

/**
 * The subset of the WebMCP `ModelContext` API
 * (https://webmachinelearning.github.io/webmcp/) that the registry depends on.
 * Kept structural so the code works against the real browser API and test
 * doubles alike. Aborting the registration signal unregisters the tool.
 */
export interface WebMCPModelContext {
  registerTool(
    tool: {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
      execute: (
        args: Record<string, unknown>,
        options: { signal?: AbortSignal },
      ) => Promise<unknown>;
      annotations?: WebMCPToolAnnotations;
    },
    options: { signal: AbortSignal },
  ): Promise<undefined>;
}

/**
 * Return the page's `document.modelContext`, or null when WebMCP is not
 * available (SSR, React Native, browsers without the API enabled).
 */
export function getWebMCPModelContext(): WebMCPModelContext | null {
  if (typeof document === "undefined") {
    return null;
  }
  const modelContext = (
    document as Document & { modelContext?: WebMCPModelContext }
  ).modelContext;
  return modelContext ?? null;
}

interface WebMCPRegistryEntry {
  tool: FrontendTool<any>;
  controller: AbortController;
}

/**
 * Keeps a set of frontend tools registered on the page's WebMCP model context.
 *
 * `sync(desired)` reconciles the registrations with the desired set: tools that
 * are gone (or were re-registered with a new tool object) are unregistered by
 * aborting their registration signal, and new tools are registered with an
 * `execute` that delegates to the frontend tool's own handler.
 *
 * All WebMCP-API constraints live here so callers only supply the desired set:
 * a tool without a description is skipped with a warning (the spec rejects
 * empty descriptions), and failures from `registerTool` (duplicate name,
 * unsupported context, ...) are warned rather than thrown.
 */
export class WebMCPRegistry {
  private entries = new Map<string, WebMCPRegistryEntry>();
  private warnedNames = new Set<string>();

  /** Names currently kept registered on the model context. */
  get registeredNames(): string[] {
    return [...this.entries.keys()];
  }

  /** Reconcile the registered tools with the desired set. */
  sync(desired: Map<string, FrontendTool<any>>): void {
    const modelContext = getWebMCPModelContext();
    if (!modelContext) {
      return;
    }

    for (const [name, entry] of [...this.entries]) {
      if (desired.get(name) !== entry.tool) {
        entry.controller.abort();
        this.entries.delete(name);
      }
    }

    for (const [name, tool] of desired) {
      if (this.entries.has(name)) {
        continue;
      }
      if (!tool.description) {
        this.warnOnce(
          name,
          `Skipping WebMCP registration for tool '${name}': WebMCP requires a description.`,
        );
        continue;
      }

      const controller = new AbortController();
      this.entries.set(name, { tool, controller });
      modelContext
        .registerTool(
          this.buildModelContextTool(
            tool as FrontendTool<any> & { description: string },
          ),
          { signal: controller.signal },
        )
        .catch((error) => {
          // Registration failed (duplicate name, insecure context, permission
          // policy, ...). Drop the bookkeeping; the browser never registered.
          // Only delete while this is still the active registration: an
          // aborted registration can reject after a newer one already replaced
          // it, and that replacement's bookkeeping must survive.
          if (this.entries.get(name)?.controller !== controller) {
            return;
          }
          this.entries.delete(name);
          const message =
            error instanceof Error ? error.message : String(error);
          this.warnOnce(
            name,
            `WebMCP registration failed for tool '${name}': ${message}`,
          );
        });
    }
  }

  /**
   * Build the WebMCP model-context tool for a frontend tool. The `execute`
   * callback delegates to the frontend tool's own handler, so a browser agent
   * call runs the same application code as an agent call.
   */
  private buildModelContextTool(
    tool: FrontendTool<any> & { description: string },
  ): {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    execute: (
      args: Record<string, unknown>,
      options: { signal?: AbortSignal },
    ) => Promise<unknown>;
    annotations?: WebMCPToolAnnotations;
  } {
    const annotations =
      typeof tool.webmcp === "object" ? tool.webmcp.annotations : undefined;
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: createToolSchema(tool),
      execute: async (args, options) => {
        if (!tool.handler) {
          // Mirrors core's empty tool result for a display-only tool.
          return "";
        }
        const toolCall: ToolCall = {
          id: randomUUID(),
          type: "function",
          function: {
            name: tool.name,
            arguments: JSON.stringify(args ?? {}),
          },
        };
        return await tool.handler(args as any, {
          toolCall,
          signal: options?.signal,
        });
      },
      ...(annotations ? { annotations } : {}),
    };
  }

  /** Log `message` once per tool name. Repeated syncs must not spam the log. */
  private warnOnce(name: string, message: string): void {
    if (this.warnedNames.has(name)) {
      return;
    }
    this.warnedNames.add(name);
    logger.warn(`[CopilotKit] ${message}`);
  }
}
