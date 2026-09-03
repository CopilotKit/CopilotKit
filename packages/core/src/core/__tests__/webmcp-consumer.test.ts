import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "@copilotkit/shared";
import { RunHandler } from "../run-handler";
import type { CopilotKitCore } from "../core";
import { WebMCPConsumer } from "../webmcp";
import type { WebMCPRegisteredTool } from "../webmcp";
import { createToolSchema } from "../tool-schema";

type FakeModelContext = {
  pageTools: WebMCPRegisteredTool[];
  registerTool: ReturnType<typeof vi.fn>;
  getTools: ReturnType<typeof vi.fn>;
  executeTool: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  emitToolChange: () => void;
};

function createPageTool(
  overrides: Partial<WebMCPRegisteredTool> & Pick<WebMCPRegisteredTool, "name">,
): WebMCPRegisteredTool {
  return {
    description: `${overrides.name} description`,
    inputSchema: { type: "object", properties: {} },
    ...overrides,
  };
}

function createFakeImportContext(
  pageTools: WebMCPRegisteredTool[] = [],
): FakeModelContext {
  const listeners = new Set<(event: { type: string }) => void>();
  const context: FakeModelContext = {
    pageTools,
    registerTool: vi.fn(async () => undefined),
    getTools: vi.fn(async () => context.pageTools.slice()),
    executeTool: vi.fn(async (tool: WebMCPRegisteredTool, input) => ({
      ran: tool.name,
      input,
    })),
    addEventListener: vi.fn(
      (type: string, listener: (event: { type: string }) => void) => {
        if (type === "toolchange") {
          listeners.add(listener);
        }
      },
    ),
    removeEventListener: vi.fn(
      (type: string, listener: (event: { type: string }) => void) => {
        listeners.delete(listener);
      },
    ),
    emitToolChange: () => {
      for (const listener of listeners) {
        listener({ type: "toolchange" });
      }
    },
  };
  return context;
}

function stubImportWebMCP(pageTools: WebMCPRegisteredTool[] = []) {
  const modelContext = createFakeImportContext(pageTools);
  vi.stubGlobal("document", { modelContext });
  return modelContext;
}

function createHost() {
  return new RunHandler({} as CopilotKitCore);
}

async function startedConsumer(
  host: RunHandler,
  options?: Parameters<WebMCPConsumer["start"]>[0],
) {
  const consumer = new WebMCPConsumer(host);
  consumer.start(options);
  await vi.waitFor(() => {
    expect(host.tools.length).toBeGreaterThanOrEqual(0);
  });
  // Let the in-flight getTools() land.
  await Promise.resolve();
  await Promise.resolve();
  return consumer;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("WebMCPConsumer", () => {
  it("imports every same-origin page tool when no filters are set", async () => {
    const addTodo = createPageTool({ name: "addTodo" });
    const listTodos = createPageTool({ name: "listTodos" });
    stubImportWebMCP([addTodo, listTodos]);
    const host = createHost();

    await startedConsumer(host);

    await vi.waitFor(() => {
      expect(host.tools.map((tool) => tool.name).sort()).toEqual([
        "addTodo",
        "listTodos",
      ]);
    });
    expect(host.tools.every((tool) => tool.webmcp === undefined)).toBe(true);
  });

  it("is a no-op without document.modelContext", () => {
    const host = createHost();
    const consumer = new WebMCPConsumer(host);

    expect(() => consumer.start()).not.toThrow();
    expect(host.tools).toEqual([]);
  });

  it("is a no-op when getTools and executeTool are missing", () => {
    vi.stubGlobal("document", {
      modelContext: {
        registerTool: vi.fn(async () => undefined),
      },
    });
    const host = createHost();
    const consumer = new WebMCPConsumer(host);

    expect(() => consumer.start()).not.toThrow();
    expect(host.tools).toEqual([]);
  });

  it("does not call registerTool for imported tools", async () => {
    const modelContext = stubImportWebMCP([
      createPageTool({ name: "addTodo" }),
    ]);
    const host = createHost();

    await startedConsumer(host);
    await vi.waitFor(() => {
      expect(host.tools.map((tool) => tool.name)).toEqual(["addTodo"]);
    });

    expect(modelContext.registerTool).not.toHaveBeenCalled();
  });

  it("skips names CopilotKit already published with webmcp: true", async () => {
    const modelContext = stubImportWebMCP([
      createPageTool({ name: "sayHello" }),
      createPageTool({ name: "addTodo" }),
    ]);
    const host = createHost();
    host.addTool({
      name: "sayHello",
      description: "Say hello",
      webmcp: true,
    });
    expect(modelContext.registerTool).toHaveBeenCalled();
    expect(host.getPublishedWebMCPNames()).toContain("sayHello");

    await startedConsumer(host);

    await vi.waitFor(() => {
      expect(host.tools.filter((tool) => tool.name === "addTodo")).toHaveLength(
        1,
      );
    });
    expect(
      host.tools.filter((tool) => tool.name === "sayHello" && !tool.webmcp),
    ).toHaveLength(0);
  });

  it("applies allow, then deny, then name", async () => {
    stubImportWebMCP([
      createPageTool({ name: "keepMe" }),
      createPageTool({ name: "denyMe" }),
      createPageTool({ name: "other" }),
      createPageTool({ name: "keepTwo" }),
    ]);
    const host = createHost();

    await startedConsumer(host, {
      allow: ["keepMe", "denyMe", "keepTwo"],
      deny: ["denyMe"],
      name: /^keep/,
    });

    await vi.waitFor(() => {
      expect(host.tools.map((tool) => tool.name).sort()).toEqual([
        "keepMe",
        "keepTwo",
      ]);
    });
  });

  it("matches an exact name string", async () => {
    stubImportWebMCP([
      createPageTool({ name: "addTodo" }),
      createPageTool({ name: "listTodos" }),
    ]);
    const host = createHost();

    await startedConsumer(host, { name: "addTodo" });

    await vi.waitFor(() => {
      expect(host.tools.map((tool) => tool.name)).toEqual(["addTodo"]);
    });
  });

  it("deny wins when a name is on both allow and deny", async () => {
    stubImportWebMCP([
      createPageTool({ name: "shared" }),
      createPageTool({ name: "kept" }),
    ]);
    const host = createHost();

    await startedConsumer(host, {
      allow: ["shared", "kept"],
      deny: ["shared"],
    });

    await vi.waitFor(() => {
      expect(host.tools.map((tool) => tool.name)).toEqual(["kept"]);
    });
  });

  it("skips and warns when a CopilotKit tool already uses the name", async () => {
    stubImportWebMCP([createPageTool({ name: "existing" })]);
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const host = createHost();
    host.addTool({
      name: "existing",
      description: "hand written",
    });

    await startedConsumer(host);

    await Promise.resolve();
    await Promise.resolve();

    expect(host.tools).toHaveLength(1);
    expect(host.tools[0]?.description).toBe("hand written");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Skipping WebMCP import for tool 'existing'"),
    );
  });

  it("calls executeTool with the RegisteredTool from getTools, not a name string", async () => {
    const pageTool = createPageTool({
      name: "addTodo",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
      },
    });
    const modelContext = stubImportWebMCP([pageTool]);
    const host = createHost();

    await startedConsumer(host);
    await vi.waitFor(() => {
      expect(host.getTool({ toolName: "addTodo" })?.handler).toBeTypeOf(
        "function",
      );
    });

    const imported = host.getTool({ toolName: "addTodo" });
    const result = await imported!.handler!(
      { text: "milk" },
      {
        toolCall: {
          id: "call-1",
          type: "function",
          function: { name: "addTodo", arguments: '{"text":"milk"}' },
        },
      },
    );

    expect(modelContext.executeTool).toHaveBeenCalledTimes(1);
    const [executedTool, input] = modelContext.executeTool.mock.calls[0]!;
    expect(executedTool).toBe(pageTool);
    expect(typeof executedTool).toBe("object");
    expect(input).toEqual({ text: "milk" });
    expect(result).toEqual({ ran: "addTodo", input: { text: "milk" } });
  });

  it("advertises the page tool inputSchema to the agent", async () => {
    const inputSchema = {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    };
    stubImportWebMCP([
      createPageTool({
        name: "addTodo",
        inputSchema,
      }),
    ]);
    const host = createHost();

    await startedConsumer(host);
    await vi.waitFor(() => {
      expect(host.getTool({ toolName: "addTodo" })).toBeDefined();
    });

    const schema = createToolSchema(host.getTool({ toolName: "addTodo" })!);
    expect(schema).toEqual(inputSchema);
  });

  it("stores agentId on the registered frontend tool", async () => {
    stubImportWebMCP([createPageTool({ name: "addTodo" })]);
    const host = createHost();

    await startedConsumer(host, { agentId: "support" });
    await vi.waitFor(() => {
      expect(
        host.getTool({ toolName: "addTodo", agentId: "support" })?.agentId,
      ).toBe("support");
    });
  });

  it("re-syncs on toolchange: adds new tools and removes gone ones", async () => {
    const addTodo = createPageTool({ name: "addTodo" });
    const listTodos = createPageTool({ name: "listTodos" });
    const modelContext = stubImportWebMCP([addTodo]);
    const host = createHost();

    await startedConsumer(host);
    await vi.waitFor(() => {
      expect(host.tools.map((tool) => tool.name)).toEqual(["addTodo"]);
    });

    modelContext.pageTools = [listTodos];
    modelContext.emitToolChange();

    await vi.waitFor(() => {
      expect(host.tools.map((tool) => tool.name)).toEqual(["listTodos"]);
    });
  });

  it("stop() removes only tools this instance added", async () => {
    stubImportWebMCP([createPageTool({ name: "addTodo" })]);
    const host = createHost();
    host.addTool({
      name: "handWritten",
      description: "stays",
    });

    const consumer = await startedConsumer(host);
    await vi.waitFor(() => {
      expect(host.tools.map((tool) => tool.name).sort()).toEqual([
        "addTodo",
        "handWritten",
      ]);
    });

    consumer.stop();

    expect(host.tools.map((tool) => tool.name)).toEqual(["handWritten"]);
  });

  it("ignores a stale getTools() result after a newer sync", async () => {
    let resolveFirst!: (tools: WebMCPRegisteredTool[]) => void;
    const firstBatch = [createPageTool({ name: "stale" })];
    const secondBatch = [createPageTool({ name: "fresh" })];
    const listeners = new Set<(event: { type: string }) => void>();
    let getToolsCalls = 0;
    const getTools = vi.fn(async () => {
      getToolsCalls += 1;
      if (getToolsCalls === 1) {
        return await new Promise<WebMCPRegisteredTool[]>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return secondBatch;
    });
    vi.stubGlobal("document", {
      modelContext: {
        registerTool: vi.fn(async () => undefined),
        getTools,
        executeTool: vi.fn(async () => "ok"),
        addEventListener: (
          type: string,
          listener: (event: { type: string }) => void,
        ) => {
          if (type === "toolchange") {
            listeners.add(listener);
          }
        },
        removeEventListener: (
          type: string,
          listener: (event: { type: string }) => void,
        ) => {
          listeners.delete(listener);
        },
      },
    });
    const host = createHost();
    const consumer = new WebMCPConsumer(host);
    consumer.start();

    await vi.waitFor(() => {
      expect(getTools).toHaveBeenCalledTimes(1);
    });

    for (const listener of listeners) {
      listener({ type: "toolchange" });
    }

    await vi.waitFor(() => {
      expect(getTools).toHaveBeenCalledTimes(2);
      expect(host.tools.map((tool) => tool.name)).toEqual(["fresh"]);
    });

    resolveFirst(firstBatch);
    await Promise.resolve();
    await Promise.resolve();

    expect(host.tools.map((tool) => tool.name)).toEqual(["fresh"]);
  });

  it("skips a page tool with an empty description and warns", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    stubImportWebMCP([
      { name: "noDescription", description: "" },
      createPageTool({ name: "addTodo" }),
    ]);
    const host = createHost();

    await startedConsumer(host);
    await vi.waitFor(() => {
      expect(host.tools.map((tool) => tool.name)).toEqual(["addTodo"]);
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("need a description"),
    );
  });
});
