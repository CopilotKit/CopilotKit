import type { ToolCall } from "@ag-ui/client";
import { logger, randomUUID } from "@copilotkit/shared";
import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from "@copilotkit/shared";
import type { FrontendTool, WebMCPToolAnnotations } from "../types";
import { createToolSchema } from "./tool-schema";

const TOOLCHANGE_EVENT = "toolchange";

/**
 * A tool returned by `document.modelContext.getTools()`. The object is an
 * opaque handle for `executeTool`; do not call it by name string.
 */
export type WebMCPRegisteredTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: WebMCPToolAnnotations;
  origin?: string;
  title?: string;
};

/**
 * Filters for importing page WebMCP tools into CopilotKit.
 *
 * Applied in order: allow, then deny, then `name`. Deny wins when a name is
 * on both lists. With no filters, every same-origin tool is imported.
 */
export type WebMCPToolsOptions = {
  /** Scope imported tools to this agent. Omit for global tools. */
  agentId?: string;
  /** If set, only these names are imported. */
  allow?: readonly string[];
  /** These names are never imported. */
  deny?: readonly string[];
  /** Keep an exact name, or names that match this regular expression. */
  name?: string | RegExp;
};

/**
 * Tool registry surface the importer writes to. `CopilotKitCore` and
 * `RunHandler` both match this shape.
 */
export type WebMCPToolHost = {
  addTool: (tool: FrontendTool) => void;
  removeTool: (name: string, agentId?: string) => void;
  getTool: (params: {
    toolName: string;
    agentId?: string;
  }) => FrontendTool | undefined;
  readonly tools: ReadonlyArray<FrontendTool>;
  getPublishedWebMCPNames: () => readonly string[];
};

type ToolChangeListener = (event: { type: string }) => void;

/**
 * The subset of the WebMCP `ModelContext` API
 * (https://webmachinelearning.github.io/webmcp/) that CopilotKit depends on.
 * Kept structural so the code works against the real browser API and test
 * doubles alike. Aborting the registration signal unregisters a published tool.
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
  getTools?(options?: {
    fromOrigins?: string[];
  }): Promise<WebMCPRegisteredTool[]>;
  executeTool?(
    tool: WebMCPRegisteredTool,
    inputObject?: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
  addEventListener?(type: string, listener: ToolChangeListener): void;
  removeEventListener?(type: string, listener: ToolChangeListener): void;
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
  tool: FrontendTool;
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
  sync(desired: Map<string, FrontendTool>): void {
    const modelContext = getWebMCPModelContext();
    if (!modelContext) {
      return;
    }

    const currentEntries = Array.from(this.entries);
    for (const [name, entry] of currentEntries) {
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
        warnOnce(
          this.warnedNames,
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
            tool as FrontendTool & { description: string },
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
          warnOnce(
            this.warnedNames,
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
  private buildModelContextTool(tool: FrontendTool & { description: string }): {
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
        return await tool.handler(args, {
          toolCall,
          signal: options?.signal,
        });
      },
      ...(annotations ? { annotations } : {}),
    };
  }
}

interface OwnedWebMCPImport {
  agentId?: string;
  registeredTool: WebMCPRegisteredTool;
}

/**
 * Imports page WebMCP tools into a CopilotKit tool host so a CopilotKit agent
 * can call them. One instance per `useWebmcpTools` / `registerWebmcpTools`
 * call. Missing `document.modelContext` is a no-op.
 */
export class WebMCPConsumer {
  private options: WebMCPToolsOptions = {};
  private owned = new Map<string, OwnedWebMCPImport>();
  private syncGeneration = 0;
  private started = false;
  private warnedNames = new Set<string>();
  private readonly onToolChange: ToolChangeListener = () => {
    void this.sync();
  };

  constructor(private host: WebMCPToolHost) {}

  /**
   * Start listening and import matching page tools. Calling `start` again
   * stops the previous session first.
   */
  start(options: WebMCPToolsOptions = {}) {
    this.stop();
    this.options = options;
    this.started = true;
    const modelContext = getImportModelContext();
    if (!modelContext) {
      return;
    }
    modelContext.addEventListener?.(TOOLCHANGE_EVENT, this.onToolChange);
    void this.sync();
  }

  /**
   * Remove tools this instance added and drop the `toolchange` listener.
   */
  stop() {
    this.syncGeneration += 1;
    const modelContext = getWebMCPModelContext();
    modelContext?.removeEventListener?.(TOOLCHANGE_EVENT, this.onToolChange);
    this.removeOwned();
    this.started = false;
  }

  private async sync() {
    if (!this.started) {
      return;
    }
    const generation = ++this.syncGeneration;
    const modelContext = getImportModelContext();
    if (!modelContext) {
      return;
    }

    let pageTools: WebMCPRegisteredTool[];
    try {
      pageTools = await modelContext.getTools();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnOnce(this.warnedNames, "*", `WebMCP getTools() failed: ${message}`);
      return;
    }

    if (generation !== this.syncGeneration || !this.started) {
      return;
    }

    const desired = new Map<string, WebMCPRegisteredTool>();
    const published = new Set(this.host.getPublishedWebMCPNames());
    const pageToolList = pageTools;

    for (const pageTool of pageToolList) {
      if (!pageTool.name) {
        continue;
      }
      if (!pageTool.description) {
        warnOnce(
          this.warnedNames,
          pageTool.name,
          `Skipping WebMCP import for tool '${pageTool.name}': WebMCP tools need a description.`,
        );
        continue;
      }
      if (!shouldImportPageTool(pageTool, this.options, published)) {
        continue;
      }
      desired.set(pageTool.name, pageTool);
    }

    const ownedEntries = Array.from(this.owned);
    for (const [name, entry] of ownedEntries) {
      if (desired.has(name)) {
        continue;
      }
      this.host.removeTool(name, entry.agentId);
      this.owned.delete(name);
    }

    for (const [name, pageTool] of desired) {
      const existing = this.owned.get(name);
      if (existing) {
        existing.registeredTool = pageTool;
        continue;
      }
      if (hasExactTool(this.host, name, this.options.agentId)) {
        warnOnce(
          this.warnedNames,
          name,
          `Skipping WebMCP import for tool '${name}': a CopilotKit tool with this name is already registered.`,
        );
        continue;
      }
      const owned: OwnedWebMCPImport = {
        agentId: this.options.agentId,
        registeredTool: pageTool,
      };
      this.owned.set(name, owned);
      this.host.addTool({
        name,
        description: pageTool.description,
        agentId: this.options.agentId,
        parameters: jsonSchemaAsStandardSchema(
          pageTool.inputSchema ?? { type: "object", properties: {} },
        ),
        handler: async (args, context) => {
          const executeContext = getImportModelContext();
          if (!executeContext) {
            throw new Error("WebMCP executeTool is not available");
          }
          try {
            return await executeContext.executeTool(
              owned.registeredTool,
              args ?? {},
              { signal: context.signal },
            );
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            warnOnce(
              this.warnedNames,
              name,
              `WebMCP executeTool failed for tool '${name}': ${message}`,
            );
            throw error;
          }
        },
      });
    }
  }

  private removeOwned() {
    for (const [name, entry] of this.owned) {
      this.host.removeTool(name, entry.agentId);
    }
    this.owned.clear();
  }
}

type ImportModelContext = WebMCPModelContext & {
  getTools: NonNullable<WebMCPModelContext["getTools"]>;
  executeTool: NonNullable<WebMCPModelContext["executeTool"]>;
};

function isImportModelContext(
  modelContext: WebMCPModelContext | null,
): modelContext is ImportModelContext {
  return (
    modelContext != null &&
    typeof modelContext.getTools === "function" &&
    typeof modelContext.executeTool === "function"
  );
}

function getImportModelContext() {
  const modelContext = getWebMCPModelContext();
  if (!isImportModelContext(modelContext)) {
    return null;
  }
  return modelContext;
}

function shouldImportPageTool(
  pageTool: WebMCPRegisteredTool,
  options: WebMCPToolsOptions,
  published: Set<string>,
) {
  const toolName = pageTool.name;
  if (!toolName) {
    return false;
  }
  if (published.has(toolName)) {
    return false;
  }
  if (options.allow && !options.allow.includes(toolName)) {
    return false;
  }
  if (options.deny?.includes(toolName)) {
    return false;
  }
  return matchesNameFilter(toolName, options.name);
}

function matchesNameFilter(
  toolName: string,
  name: string | RegExp | undefined,
) {
  if (name === undefined) {
    return true;
  }
  if (typeof name === "string") {
    return toolName === name;
  }
  return name.test(toolName);
}

function hasExactTool(host: WebMCPToolHost, name: string, agentId?: string) {
  return host.tools.some(
    (tool) => tool.name === name && tool.agentId === agentId,
  );
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonSchemaAsStandardSchema(inputSchema: Record<string, unknown>) {
  const toJsonSchema = () => inputSchema;
  const schema: StandardSchemaV1<
    Record<string, unknown>,
    Record<string, unknown>
  > &
    StandardJSONSchemaV1<Record<string, unknown>, Record<string, unknown>> = {
    "~standard": {
      version: 1,
      vendor: "copilotkit-webmcp",
      validate: (value) => ({
        value: isJsonObject(value) ? value : {},
      }),
      jsonSchema: {
        input: toJsonSchema,
        output: toJsonSchema,
      },
    },
  };
  return schema;
}

function warnOnce(warnedNames: Set<string>, name: string, message: string) {
  if (warnedNames.has(name)) {
    return;
  }
  warnedNames.add(name);
  logger.warn(`[CopilotKit] ${message}`);
}
