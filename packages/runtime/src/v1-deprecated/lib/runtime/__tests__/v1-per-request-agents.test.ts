import { describe, it, expect, vi, beforeEach } from "vitest";
import { HttpAgent } from "@ag-ui/client";
import { BuiltInAgent } from "../../../../agent";
import { CopilotRuntime } from "../copilot-runtime";
import { resolveAgents } from "../../../../v2/runtime/core/runtime";
import {
  __resetMCPClientCache,
  __mcpClientCacheSize,
  resolveMCPEntry,
} from "../mcp-client-cache";

const adapter = { name: "OpenAIAdapter" } as any;

const agents = () =>
  ({ default: new HttpAgent({ url: "https://example.com/a" }) }) as any;

/** A POST the browser would send, carrying `forwardedProps`. */
function requestWith(
  forwardedProps: Record<string, unknown>,
  url = "https://app.example.com/api/copilotkit",
) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      threadId: "t",
      runId: "r",
      messages: [],
      state: {},
      tools: [],
      context: [],
      forwardedProps,
    }),
  });
}

/** Resolve the runtime's agents the way the request path does. */
async function resolveFor(runtime: CopilotRuntime, request: Request) {
  return (await resolveAgents(runtime.instance.agents, request)) as any;
}

function toolsOf(resolved: any, agentId = "default") {
  return (Reflect.get(resolved[agentId], "config") as any)?.tools ?? [];
}

/** One MCP server exposing a single named tool. */
const toolsFor = (name: string) => ({
  [name]: {
    description: name,
    schema: { parameters: { properties: {}, required: [] } },
    execute: async () => "ok",
  },
});

beforeEach(async () => {
  await __resetMCPClientCache();
});

describe("v1 agents resolve per request", () => {
  it("gives a dynamic `actions` function the request's properties and url", async () => {
    const seen: Array<{ properties: any; url?: string }> = [];
    const runtime = new CopilotRuntime({
      agents: agents(),
      actions: (ctx: any) => {
        seen.push(ctx);
        return [];
      },
    } as any);
    runtime.handleServiceAdapter(adapter);

    await resolveFor(
      runtime,
      requestWith({ tenant: "acme" }, "https://app.example.com/api/copilotkit"),
    );

    // Before this change the resolver was called once, at startup, with
    // `{ properties: {}, url: undefined }` (#7116).
    expect(seen).toHaveLength(1);
    expect(seen[0].properties).toEqual({ tenant: "acme" });
    expect(seen[0].url).toBe("https://app.example.com/api/copilotkit");
  });

  it("re-evaluates the action list on every request", async () => {
    const runtime = new CopilotRuntime({
      agents: agents(),
      actions: ({ properties }: any) => [
        {
          name: `tool_for_${properties.tenant}`,
          description: "",
          parameters: [],
          handler: async () => "ok",
        },
      ],
    } as any);
    runtime.handleServiceAdapter(adapter);

    const first = await resolveFor(runtime, requestWith({ tenant: "acme" }));
    const second = await resolveFor(runtime, requestWith({ tenant: "globex" }));

    expect(toolsOf(first).map((t: any) => t.name)).toEqual(["tool_for_acme"]);
    expect(toolsOf(second).map((t: any) => t.name)).toEqual([
      "tool_for_globex",
    ]);
  });

  it("keeps one request's tools off another request's agent", async () => {
    const runtime = new CopilotRuntime({
      agents: agents(),
      actions: ({ properties }: any) => [
        {
          name: `tool_for_${properties.tenant}`,
          description: "",
          parameters: [],
          handler: async () => "ok",
        },
      ],
    } as any);
    runtime.handleServiceAdapter(adapter);

    // Resolve both before reading either, the way two concurrent requests
    // would. Attaching tools to the shared agent instance would leave both
    // holding both tools.
    const [first, second] = await Promise.all([
      resolveFor(runtime, requestWith({ tenant: "acme" })),
      resolveFor(runtime, requestWith({ tenant: "globex" })),
    ]);

    expect(toolsOf(first).map((t: any) => t.name)).toEqual(["tool_for_acme"]);
    expect(toolsOf(second).map((t: any) => t.name)).toEqual([
      "tool_for_globex",
    ]);
    expect(first.default).not.toBe(second.default);
  });

  it("does not accumulate tools when the endpoint is rebuilt per request", async () => {
    // The documented v1 route builds the endpoint inside the request handler,
    // so `handleServiceAdapter` runs once per request against one runtime.
    const runtime = new CopilotRuntime({
      agents: agents(),
      actions: [
        {
          name: "greet",
          description: "",
          parameters: [],
          handler: async () => "hi",
        },
      ],
    } as any);

    const names: string[][] = [];
    for (let i = 0; i < 3; i++) {
      runtime.handleServiceAdapter(adapter);
      const resolved = await resolveFor(runtime, requestWith({}));
      names.push(toolsOf(resolved).map((t: any) => t.name));
    }

    expect(names).toEqual([["greet"], ["greet"], ["greet"]]);
  });

  it("hands back the shared agents untouched when there is nothing to attach", async () => {
    const base = agents();
    const runtime = new CopilotRuntime({ agents: base } as any);
    runtime.handleServiceAdapter(adapter);

    const resolved = await resolveFor(runtime, requestWith({}));

    // No actions and no MCP means no clone and no config write: byte for byte
    // the behaviour a runtime had before agents became a factory.
    expect(resolved.default).toBe(base.default);
  });

  it("keeps a real BuiltInAgent's own tools through the clone", async () => {
    // The sibling suite proves this with an HttpAgent carrying a hand-set
    // `config`, which is a replica. `BuiltInAgent.clone()` rebuilds from
    // `this.config`, so run the guarantee against the real thing: a v1 action
    // must not shadow a tool the agent declares itself.
    const own = vi.fn().mockResolvedValue("from the agent");
    const agent = new BuiltInAgent({
      model: "openai/gpt-4o",
      tools: [{ name: "greet", parameters: {} as any, execute: own }],
    } as any);

    const runtime = new CopilotRuntime({
      agents: { default: agent } as any,
      actions: [
        { name: "greet", parameters: [], handler: () => "from v1" },
        { name: "other", parameters: [], handler: () => "v1 only" },
      ],
    } as any);
    runtime.handleServiceAdapter(adapter);

    const resolved = await resolveFor(runtime, requestWith({}));
    const tools = toolsOf(resolved);
    const greet = tools.filter((t: any) => t.name === "greet");

    expect(greet).toHaveLength(1);
    expect(await greet[0].execute({})).toBe("from the agent");
    expect(tools.map((t: any) => t.name)).toContain("other");
    // The registered agent is untouched, so the next request starts clean.
    expect(
      (Reflect.get(agent, "config") as any).tools.map((t: any) => t.name),
    ).toEqual(["greet"]);
  });

  it("calls a caller-supplied agents factory, with the request", async () => {
    // `agents` accepts a factory on the v1 constructor too. A function has no
    // enumerable keys, so it read as an empty record: the service adapter's
    // default replaced it and the caller's function was never invoked.
    const mine = new HttpAgent({ url: "https://example.com/mine" });
    const factory = vi.fn(({ request }: any) => {
      expect(request).toBeInstanceOf(Request);
      return { mine };
    });

    const runtime = new CopilotRuntime({
      agents: factory as any,
      actions: [{ name: "greet", parameters: [], handler: async () => "hi" }],
    } as any);
    runtime.handleServiceAdapter(adapter);

    const first = await resolveFor(runtime, requestWith({}));
    const second = await resolveFor(runtime, requestWith({}));

    expect(factory).toHaveBeenCalledTimes(2);
    expect(Object.keys(first)).toEqual(["mine"]);
    expect(Object.keys(second)).toEqual(["mine"]);
    expect(toolsOf(first, "mine").map((t: any) => t.name)).toEqual(["greet"]);
    // Still a clone: the caller's own instance never takes the v1 tools.
    expect(first.mine).not.toBe(mine);
    expect(Reflect.get(mine, "config")).toBeUndefined();
  });

  it("still supplies the adapter's default when a factory returns nothing", async () => {
    const runtime = new CopilotRuntime({
      agents: (() => ({})) as any,
    } as any);
    runtime.handleServiceAdapter({
      name: "OpenAIAdapter",
      provider: "openai",
      model: "gpt-4o",
    } as any);

    const resolved = await resolveFor(runtime, requestWith({}));
    expect(Object.keys(resolved)).toEqual(["default"]);
  });

  it("resolves for a GET with no body", async () => {
    // The `/info` route reaches the same factory.
    const runtime = new CopilotRuntime({
      agents: agents(),
      actions: ({ properties }: any) => {
        expect(properties).toEqual({});
        return [];
      },
    } as any);
    runtime.handleServiceAdapter(adapter);

    const resolved = await resolveFor(
      runtime,
      new Request("https://app.example.com/api/copilotkit/info"),
    );
    expect(Object.keys(resolved)).toEqual(["default"]);
  });
});

describe("v1 MCP clients are keyed by credential", () => {
  it("builds one client per distinct credential for the same endpoint", async () => {
    const created: Array<Record<string, unknown>> = [];
    const createMCPClient = vi.fn(async (config: any) => {
      created.push(config);
      return { tools: async () => toolsFor(`tool_${config.apiKey}`) };
    });

    const runtime = new CopilotRuntime({
      agents: agents(),
      createMCPClient,
      mcpServers: [],
    } as any);
    runtime.handleServiceAdapter(adapter);

    const alice = await resolveFor(
      runtime,
      requestWith({
        mcpServers: [{ endpoint: "https://mcp.example.com", apiKey: "alice" }],
      }),
    );
    const bob = await resolveFor(
      runtime,
      requestWith({
        mcpServers: [{ endpoint: "https://mcp.example.com", apiKey: "bob" }],
      }),
    );

    // Keyed by URL alone, Bob was served the client built with Alice's key.
    expect(created.map((c) => c.apiKey)).toEqual(["alice", "bob"]);
    expect(toolsOf(alice).map((t: any) => t.name)).toEqual(["tool_alice"]);
    expect(toolsOf(bob).map((t: any) => t.name)).toEqual(["tool_bob"]);
  });

  it("reuses one client when the config is identical", async () => {
    const createMCPClient = vi.fn(async () => ({
      tools: async () => toolsFor("search"),
    }));
    const runtime = new CopilotRuntime({
      agents: agents(),
      createMCPClient,
      mcpServers: [{ endpoint: "https://mcp.example.com", apiKey: "k" }],
    } as any);
    runtime.handleServiceAdapter(adapter);

    await resolveFor(runtime, requestWith({}));
    await resolveFor(runtime, requestWith({}));
    await resolveFor(runtime, requestWith({}));

    // One connection, not one per run: an MCP handshake per message would be
    // a latency regression for every user who has a server configured.
    expect(createMCPClient).toHaveBeenCalledTimes(1);
  });

  it("never hands one runtime's client to a runtime with a different factory", async () => {
    const first = vi.fn(async () => ({ tools: async () => toolsFor("a") }));
    const second = vi.fn(async () => ({ tools: async () => toolsFor("b") }));
    const config = {
      agents: agents(),
      mcpServers: [{ endpoint: "https://mcp.example.com" }],
    };

    const runtimeA = new CopilotRuntime({
      ...config,
      createMCPClient: first,
    } as any);
    runtimeA.handleServiceAdapter(adapter);
    const runtimeB = new CopilotRuntime({
      ...config,
      agents: agents(),
      createMCPClient: second,
    } as any);
    runtimeB.handleServiceAdapter(adapter);

    const a = await resolveFor(runtimeA, requestWith({}));
    const b = await resolveFor(runtimeB, requestWith({}));

    expect(toolsOf(a).map((t: any) => t.name)).toEqual(["a"]);
    expect(toolsOf(b).map((t: any) => t.name)).toEqual(["b"]);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("retries an endpoint that failed its first connection", async () => {
    let attempt = 0;
    const createMCPClient = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("connection refused");
      return { tools: async () => toolsFor("search") };
    });
    const runtime = new CopilotRuntime({
      agents: agents(),
      createMCPClient,
      mcpServers: [{ endpoint: "https://mcp.example.com" }],
    } as any);
    runtime.handleServiceAdapter(adapter);

    const down = await resolveFor(runtime, requestWith({}));
    const up = await resolveFor(runtime, requestWith({}));

    expect(toolsOf(down)).toEqual([]);
    expect(toolsOf(up).map((t: any) => t.name)).toEqual(["search"]);
  });

  it("closes a client it evicts", async () => {
    const closed: string[] = [];
    const createMCPClient = vi.fn(async (config: any) => ({
      tools: async () => toolsFor("t"),
      close: async () => {
        closed.push(config.apiKey);
      },
    }));
    const runtime = new CopilotRuntime({
      agents: agents(),
      createMCPClient,
      mcpServers: [],
    } as any);
    runtime.handleServiceAdapter(adapter);

    // 101 distinct credentials against a cap of 100.
    for (let i = 0; i < 101; i++) {
      await resolveFor(
        runtime,
        requestWith({
          mcpServers: [
            { endpoint: "https://mcp.example.com", apiKey: `key-${i}` },
          ],
        }),
      );
    }

    expect(__mcpClientCacheSize()).toBe(100);
    expect(closed).toEqual(["key-0"]);
  });

  it("keeps the credential out of the log when an endpoint fails to connect", async () => {
    const errors: string[] = [];
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        errors.push(args.map(String).join(" "));
      });

    try {
      const runtime = new CopilotRuntime({
        agents: agents(),
        createMCPClient: async () => {
          throw new Error("connection refused");
        },
        mcpServers: [
          { endpoint: "https://mcp.example.com/sse?uid=SECRETHASH" },
        ],
      } as any);
      runtime.handleServiceAdapter(adapter);
      await resolveFor(runtime, requestWith({}));

      const log = errors.join("\n");
      expect(log).toContain("Failed to fetch tools from endpoint");
      expect(log).toContain("https://mcp.example.com/sse");
      // A failed connection is the common path, so this log line sees the
      // credential far more often than the close-error one does.
      expect(log).not.toContain("SECRETHASH");
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps the credential out of the tool description sent to the model", async () => {
    const runtime = new CopilotRuntime({
      agents: agents(),
      createMCPClient: async () => ({
        // No description of its own, so the fallback naming the endpoint is
        // what reaches the model provider.
        tools: async () => ({
          search: {
            schema: { parameters: { properties: {}, required: [] } },
            execute: async () => "ok",
          },
        }),
      }),
      mcpServers: [{ endpoint: "https://mcp.example.com/sse?uid=SECRETHASH" }],
    } as any);
    runtime.handleServiceAdapter(adapter);

    const resolved = await resolveFor(runtime, requestWith({}));
    const description = toolsOf(resolved)[0].description;

    expect(description).toContain("https://mcp.example.com/sse");
    expect(description).not.toContain("SECRETHASH");
  });

  it("does not evict a client whose tools are still being called", async () => {
    const closed: string[] = [];
    const createMCPClient = vi.fn(async (config: any) => ({
      tools: async () => toolsFor("t"),
      close: async () => {
        closed.push(config.apiKey);
      },
    }));
    const runtime = new CopilotRuntime({
      agents: agents(),
      createMCPClient,
      mcpServers: [],
    } as any);
    runtime.handleServiceAdapter(adapter);

    const withKey = (apiKey: string) =>
      requestWith({
        mcpServers: [{ endpoint: "https://mcp.example.com", apiKey }],
      });

    const first = await resolveFor(runtime, withKey("key-0"));
    const firstTool = toolsOf(first)[0];

    // Fill to the cap. `key-0` resolved first, so it is the oldest entry and
    // the next eviction would take it.
    for (let i = 1; i < 100; i++) {
      await resolveFor(runtime, withKey(`key-${i}`));
    }

    // The run holding `key-0` is still calling its tool.
    await firstTool.execute({});

    // One more credential pushes the cache past the cap.
    await resolveFor(runtime, withKey("key-100"));

    expect(__mcpClientCacheSize()).toBe(100);
    // The next-oldest goes instead. Closing `key-0` here would break a live
    // run: its agent still holds tool closures over that client.
    expect(closed).toEqual(["key-1"]);
  });

  it("keeps the credential out of the log when closing an evicted client fails", async () => {
    const errors: string[] = [];
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        errors.push(args.map(String).join(" "));
      });

    try {
      const createMCPClient = vi.fn(async () => ({
        tools: async () => toolsFor("t"),
        close: async () => {
          throw new Error("transport already gone");
        },
      }));
      const runtime = new CopilotRuntime({
        agents: agents(),
        createMCPClient,
        mcpServers: [],
      } as any);
      runtime.handleServiceAdapter(adapter);

      for (let i = 0; i < 101; i++) {
        await resolveFor(
          runtime,
          requestWith({
            mcpServers: [
              {
                endpoint: "https://mcp.example.com/sse",
                apiKey: `secret-${i}`,
              },
            ],
          }),
        );
      }

      const log = errors.join("\n");
      // The failure is still reported, and still says which server.
      expect(log).toContain("Failed to close the client");
      expect(log).toContain("https://mcp.example.com/sse");
      // The cache key embeds the whole config. It must not reach the log.
      expect(log).not.toContain("secret-0");
      expect(log).not.toMatch(/apiKey/);
    } finally {
      spy.mockRestore();
    }
  });
});

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A distinct `createMCPClient` identity; the cache only keys on the object. */
const clientFactory = () => () => {};

describe("the MCP client cache", () => {
  it("drops only its own entry when a connection fails", async () => {
    const factory = clientFactory();
    const config = { endpoint: "https://mcp.example.com" } as any;

    // First attempt, still in flight.
    const slow = deferred<any>();
    const failing = resolveMCPEntry(factory, config, () => slow.promise);
    failing.catch(() => {});

    // Push it out of the cache: it is the least recently used, and the cap is
    // 100. Eviction happens while the connection is still pending.
    for (let i = 0; i < 100; i++) {
      await resolveMCPEntry(
        clientFactory(),
        { endpoint: `https://other-${i}.example.com` } as any,
        async () => ({ client: {} as any, tools: [] as any[] }),
      );
    }

    // A later request re-opens the same endpoint and succeeds.
    const replacementClient = { close: vi.fn() };
    const replacement = await resolveMCPEntry(factory, config, async () => ({
      client: replacementClient as any,
      tools: ["live"],
    }));
    expect(replacement.tools).toEqual(["live"]);

    // Now the first attempt finally fails.
    slow.reject(new Error("connection refused"));
    await expect(failing).rejects.toThrow("connection refused");

    // It must not have taken the replacement with it: a third caller gets the
    // cached client rather than opening a fourth connection to the same
    // endpoint with the same credential.
    const build = vi.fn(async () => ({
      client: {} as any,
      tools: ["rebuilt"],
    }));
    const third = await resolveMCPEntry(factory, config, build);
    expect(build).not.toHaveBeenCalled();
    expect(third.tools).toEqual(["live"]);
  });
});
