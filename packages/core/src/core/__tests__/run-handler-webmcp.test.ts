import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { logger } from "@copilotkit/shared";
import type { FrontendToolHandlerContext } from "../../types";
import { RunHandler } from "../run-handler";
import type { CopilotKitCore } from "../core";

/**
 * Minimal WebMCP `document.modelContext` double. Mirrors the spec's
 * registration semantics: a duplicate name rejects, and aborting the
 * registration signal unregisters the tool.
 */
function createFakeModelContext() {
  const registered = new Map<string, { tool: any; signal: AbortSignal }>();
  const registerTool = vi.fn(
    async (tool: any, options: { signal: AbortSignal }) => {
      if (registered.has(tool.name)) {
        throw new DOMException(
          `A tool with name '${tool.name}' is already registered`,
          "InvalidStateError",
        );
      }
      registered.set(tool.name, { tool, signal: options.signal });
      options.signal.addEventListener("abort", () => {
        registered.delete(tool.name);
      });
    },
  );
  return { registered, registerTool };
}

function stubWebMCP() {
  const modelContext = createFakeModelContext();
  vi.stubGlobal("document", { modelContext });
  return modelContext;
}

function createRunHandler(): RunHandler {
  return new RunHandler({} as CopilotKitCore);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RunHandler WebMCP registration", () => {
  it("registers a webmcp-enabled tool on document.modelContext", () => {
    const modelContext = stubWebMCP();
    const runHandler = createRunHandler();

    runHandler.addTool({
      name: "sayHello",
      description: "Say hello",
      webmcp: true,
    });

    expect(modelContext.registerTool).toHaveBeenCalledTimes(1);
    const entry = modelContext.registered.get("sayHello");
    expect(entry).toBeDefined();
    expect(entry!.tool.name).toBe("sayHello");
    expect(entry!.tool.description).toBe("Say hello");
    expect(entry!.tool.inputSchema).toEqual({
      type: "object",
      properties: {},
    });
  });

  it("does not register tools without webmcp set", () => {
    const modelContext = stubWebMCP();
    const runHandler = createRunHandler();

    runHandler.addTool({ name: "plainTool", description: "No webmcp" });
    runHandler.addTool({
      name: "optOutTool",
      description: "webmcp false",
      webmcp: false,
    });

    expect(modelContext.registerTool).not.toHaveBeenCalled();
    expect(modelContext.registered.size).toBe(0);
  });

  it("is a no-op without WebMCP support (SSR, React Native)", () => {
    const runHandler = createRunHandler();

    expect(() => {
      runHandler.addTool({
        name: "sayHello",
        description: "Say hello",
        webmcp: true,
      });
    }).not.toThrow();
  });

  it("passes webmcp annotations through to the registration", () => {
    const modelContext = stubWebMCP();
    const runHandler = createRunHandler();

    runHandler.addTool({
      name: "searchDocs",
      description: "Search the docs",
      webmcp: {
        annotations: { readOnlyHint: true, untrustedContentHint: true },
      },
    });

    const entry = modelContext.registered.get("searchDocs");
    expect(entry!.tool.annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    });
  });

  it("builds inputSchema from the tool parameters", () => {
    const modelContext = stubWebMCP();
    const runHandler = createRunHandler();

    runHandler.addTool({
      name: "createProject",
      description: "Create a project",
      parameters: z.object({
        name: z.string().describe("Project name"),
      }),
      webmcp: true,
    });

    const entry = modelContext.registered.get("createProject");
    expect(entry!.tool.inputSchema.type).toBe("object");
    expect(entry!.tool.inputSchema.properties.name.type).toBe("string");
  });

  it("unregisters the tool when removeTool aborts the registration signal", () => {
    const modelContext = stubWebMCP();
    const runHandler = createRunHandler();

    runHandler.addTool({
      name: "sayHello",
      description: "Say hello",
      webmcp: true,
    });
    expect(modelContext.registered.has("sayHello")).toBe(true);

    runHandler.removeTool("sayHello");

    expect(modelContext.registered.has("sayHello")).toBe(false);
  });

  it("treats a re-registered tool object as a new definition", () => {
    const modelContext = stubWebMCP();
    const runHandler = createRunHandler();

    runHandler.addTool({
      name: "sayHello",
      description: "Say hello",
      webmcp: true,
    });
    runHandler.removeTool("sayHello");
    runHandler.addTool({
      name: "sayHello",
      description: "Say hello, updated",
      webmcp: { annotations: { readOnlyHint: true } },
    });

    const entry = modelContext.registered.get("sayHello");
    expect(entry!.tool.description).toBe("Say hello, updated");
    expect(entry!.tool.annotations).toEqual({ readOnlyHint: true });
  });

  it("applies the same availability rules as the agent tool list", () => {
    const modelContext = stubWebMCP();
    const runHandler = createRunHandler();

    runHandler.addTool({
      name: "hiddenTool",
      description: "available false",
      available: false,
      webmcp: true,
    });
    runHandler.addTool({
      name: "disabledTool",
      description: "available disabled",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      available: "disabled" as any,
      webmcp: true,
    });
    runHandler.addTool({
      name: "inspectorDisabled",
      description: "disabled via setToolEnabled",
      webmcp: true,
    });
    runHandler.setToolEnabled("inspectorDisabled", false);
    runHandler.addTool({
      name: "*",
      description: "wildcard",
      webmcp: true,
    });

    // The only registration (inspectorDisabled, before it was disabled) is
    // gone again; everything else was filtered out before registering.
    expect(modelContext.registered.size).toBe(0);

    runHandler.setToolEnabled("inspectorDisabled", true);

    expect(modelContext.registered.has("inspectorDisabled")).toBe(true);
  });

  it("keeps the first registration when two agent-scoped tools share a name", () => {
    const modelContext = stubWebMCP();
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const runHandler = createRunHandler();

    runHandler.addTool({
      name: "dup",
      description: "global",
      webmcp: true,
    });
    runHandler.addTool({
      name: "dup",
      description: "scoped",
      agentId: "a",
      webmcp: true,
    });

    expect(modelContext.registered.size).toBe(1);
    expect(modelContext.registered.get("dup")!.tool.description).toBe("global");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("share the name 'dup'"),
    );
  });

  it("skips tools without a description (WebMCP rejects empty descriptions)", () => {
    const modelContext = stubWebMCP();
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const runHandler = createRunHandler();

    runHandler.addTool({ name: "noDescription", webmcp: true });

    expect(modelContext.registerTool).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("requires a description"),
    );
  });

  it("warns instead of throwing when registerTool rejects", async () => {
    const modelContext = stubWebMCP();
    const runHandler = createRunHandler();
    runHandler.addTool({
      name: "sayHello",
      description: "Say hello",
      webmcp: true,
    });
    expect(modelContext.registered.has("sayHello")).toBe(true);

    // A second handler registers the same name against the same page context;
    // the duplicate-name rejection is warned, not thrown.
    const second = createRunHandler();
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    second.addTool({
      name: "sayHello",
      description: "Say hello again",
      webmcp: true,
    });

    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "WebMCP registration failed for tool 'sayHello'",
        ),
      );
    });
    expect(second.tools.map((t) => t.name)).toContain("sayHello");
  });

  it("executes the tool handler when a browser agent calls the tool", async () => {
    const modelContext = stubWebMCP();
    const runHandler = createRunHandler();
    const handler = vi.fn(
      async (args: { name: string }, _context: FrontendToolHandlerContext) => ({
        greeting: `Hello ${args.name}`,
      }),
    );

    runHandler.addTool({
      name: "sayHello",
      description: "Say hello",
      parameters: z.object({ name: z.string() }),
      handler,
      webmcp: true,
    });

    const entry = modelContext.registered.get("sayHello");
    const result = await entry!.tool.execute(
      { name: "Ada" },
      { signal: new AbortController().signal },
    );

    expect(result).toEqual({ greeting: "Hello Ada" });
    expect(handler).toHaveBeenCalledWith(
      { name: "Ada" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const [handlerArgs, context] = handler.mock.calls[0]!;
    expect(context.agent).toBeUndefined();
    expect(context.toolCall.function.name).toBe("sayHello");
    expect(JSON.parse(context.toolCall.function.arguments)).toEqual(
      handlerArgs,
    );
  });

  it("returns an empty string for a display-only tool without a handler", async () => {
    const modelContext = stubWebMCP();
    const runHandler = createRunHandler();

    runHandler.addTool({
      name: "showCard",
      description: "Show a card",
      webmcp: true,
    });

    const entry = modelContext.registered.get("showCard");
    const result = await entry!.tool.execute({}, {});
    expect(result).toBe("");
  });

  it("re-registers provider tools after a setTools re-sync", () => {
    const modelContext = stubWebMCP();
    const runHandler = createRunHandler();

    const original = {
      name: "providerTool",
      description: "from props",
      webmcp: true,
    };
    runHandler.initialize([original]);
    expect(modelContext.registered.get("providerTool")!.tool.description).toBe(
      "from props",
    );

    // The provider re-derives its tool list and re-syncs with a fresh object.
    runHandler.setTools([{ ...original, description: "from props, updated" }]);

    expect(modelContext.registered.get("providerTool")!.tool.description).toBe(
      "from props, updated",
    );
  });
});
