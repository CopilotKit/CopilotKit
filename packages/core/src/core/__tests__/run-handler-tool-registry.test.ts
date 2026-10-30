import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { RunHandler } from "../run-handler";
import type { CopilotKitCore } from "../core";

function createRunHandler(): RunHandler {
  return new RunHandler({} as CopilotKitCore);
}

/**
 * The registry holds two independently-owned sets of tools:
 *
 * - provider-owned (`initialize`/`setTools`) — the framework provider re-syncs
 *   this wholesale whenever its props or runtime feature flags change.
 * - imperatively-owned (`addTool`/`removeTool`) — what `useFrontendTool`,
 *   `useHumanInTheLoop`, and direct `core.addTool()` callers register.
 *
 * Issue #4952: these used to share one array, so any post-mount provider
 * re-sync silently wiped every imperatively-added tool. `openGenerativeUI`
 * made it reproducible on every mount (the `/info` response flips the flag
 * asynchronously, which re-runs the provider's sync effect), but the same
 * clobber fired for any provider-prop change.
 */
describe("RunHandler tool registry ownership (#4952)", () => {
  it("keeps addTool tools when the provider re-syncs via setTools", () => {
    const runHandler = createRunHandler();

    // Provider's initial sync (constructor) — no hook tools yet.
    runHandler.initialize([
      { name: "providerTool", description: "from props" },
    ]);

    // A hook mounts and registers its tool.
    runHandler.addTool({
      name: "sayHello",
      description: "from useFrontendTool",
    });

    // The runtime's /info response flips openGenerativeUI on, so the provider
    // re-derives allTools and re-syncs. allTools never contains hook tools.
    runHandler.setTools([
      { name: "providerTool", description: "from props" },
      { name: "generateSandboxedUi", description: "built-in" },
    ]);

    expect(runHandler.tools.map((t) => t.name).sort()).toEqual([
      "generateSandboxedUi",
      "providerTool",
      "sayHello",
    ]);
    expect(runHandler.getTool({ toolName: "sayHello" })?.description).toBe(
      "from useFrontendTool",
    );
  });

  it("advertises addTool tools to the agent after a provider re-sync", () => {
    const runHandler = createRunHandler();
    runHandler.initialize([]);
    runHandler.addTool({
      name: "sayHello",
      description: "from useFrontendTool",
      parameters: z.object({ name: z.string() }),
    });

    runHandler.setTools([
      { name: "generateSandboxedUi", description: "built-in" },
    ]);

    expect(
      runHandler
        .buildFrontendTools()
        .map((t) => t.name)
        .sort(),
    ).toEqual(["generateSandboxedUi", "sayHello"]);
  });

  it("keeps agent-scoped addTool tools distinct from global ones", () => {
    const runHandler = createRunHandler();
    runHandler.initialize([]);
    runHandler.addTool({ name: "dup", description: "global" });
    runHandler.addTool({ name: "dup", description: "scoped", agentId: "a" });

    runHandler.setTools([{ name: "providerTool", description: "p" }]);

    expect(runHandler.getTool({ toolName: "dup" })?.description).toBe("global");
    expect(
      runHandler.getTool({ toolName: "dup", agentId: "a" })?.description,
    ).toBe("scoped");
  });

  it("lets a hook tool take precedence over a provider tool of the same name", () => {
    const runHandler = createRunHandler();
    runHandler.initialize([{ name: "sayHello", description: "from props" }]);

    // Previously this warned "Tool already exists ... skipping" and dropped the
    // hook registration on the floor, because the provider had claimed the name.
    runHandler.addTool({ name: "sayHello", description: "from hook" });

    expect(runHandler.getTool({ toolName: "sayHello" })?.description).toBe(
      "from hook",
    );
    // Merged view must not list the shadowed provider entry twice.
    expect(runHandler.tools.filter((t) => t.name === "sayHello")).toHaveLength(
      1,
    );
    expect(
      runHandler.buildFrontendTools().filter((t) => t.name === "sayHello"),
    ).toHaveLength(1);
  });

  it("removeTool removes hook tools and provider tools alike", () => {
    const runHandler = createRunHandler();
    runHandler.initialize([{ name: "providerTool", description: "p" }]);
    runHandler.addTool({ name: "hookTool", description: "h" });

    runHandler.removeTool("hookTool");
    expect(runHandler.getTool({ toolName: "hookTool" })).toBeUndefined();

    runHandler.removeTool("providerTool");
    expect(runHandler.getTool({ toolName: "providerTool" })).toBeUndefined();
    expect(runHandler.tools).toHaveLength(0);
  });

  it("removeTool without an agentId leaves an agent-scoped hook tool alone", () => {
    const runHandler = createRunHandler();
    runHandler.addTool({ name: "dup", description: "global" });
    runHandler.addTool({ name: "dup", description: "scoped", agentId: "a" });

    runHandler.removeTool("dup");

    expect(runHandler.getTool({ toolName: "dup" })).toBeUndefined();
    expect(
      runHandler.getTool({ toolName: "dup", agentId: "a" })?.description,
    ).toBe("scoped");
  });

  it("re-registering a hook tool replaces it after removeTool (remount)", () => {
    const runHandler = createRunHandler();
    runHandler.addTool({ name: "sayHello", description: "first mount" });
    runHandler.removeTool("sayHello");
    runHandler.addTool({ name: "sayHello", description: "second mount" });

    expect(runHandler.getTool({ toolName: "sayHello" })?.description).toBe(
      "second mount",
    );
    expect(runHandler.tools).toHaveLength(1);
  });

  it("honours a capability toggle on a hook tool across a provider re-sync", () => {
    const runHandler = createRunHandler();
    runHandler.addTool({ name: "sayHello", description: "h" });
    runHandler.setToolEnabled("sayHello", false);

    runHandler.setTools([{ name: "providerTool", description: "p" }]);

    expect(runHandler.isToolEnabled("sayHello")).toBe(false);
    expect(runHandler.buildFrontendTools().map((t) => t.name)).toEqual([
      "providerTool",
    ]);
  });

  it("neither mutates nor tracks the array the caller handed to initialize", () => {
    const runHandler = createRunHandler();
    const provided = [{ name: "providerTool", description: "p" }];
    runHandler.initialize(provided);

    runHandler.addTool({ name: "hookTool", description: "h" });

    // `addTool` used to push straight onto the provider's own array.
    expect(provided.map((t) => t.name)).toEqual(["providerTool"]);

    // And the registry must not read through to the caller's array, since the
    // merged view is memoized and would not see the change.
    provided.push({ name: "sneaky", description: "s" });
    expect(runHandler.getTool({ toolName: "sneaky" })).toBeUndefined();
  });

  it("preserves provider order in the merged view", () => {
    const runHandler = createRunHandler();
    runHandler.initialize([
      { name: "chart", description: "c" },
      { name: "map", description: "m" },
    ]);
    runHandler.addTool({ name: "hookTool", description: "h" });

    expect(runHandler.buildFrontendTools().map((t) => t.name)).toEqual([
      "chart",
      "map",
      "hookTool",
    ]);
  });
});

function activeDescription(
  runHandler: RunHandler,
  toolName: string,
  agentId?: string,
) {
  return runHandler.getTool({ toolName, agentId })?.description;
}

/**
 * `addTool` registrations of one name + agentId stack. The newest is active,
 * and the function `addTool` returns removes only its own registration, so a
 * component that overrides a tool gives the previous one back on unmount.
 */
describe("RunHandler addTool registration stack", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("restores the provider tool when the shadowing hook tool is removed", () => {
    const runHandler = createRunHandler();
    runHandler.initialize([{ name: "sayHello", description: "from props" }]);

    const unregister = runHandler.addTool({
      name: "sayHello",
      description: "from hook",
    });
    expect(activeDescription(runHandler, "sayHello")).toBe("from hook");

    unregister();

    expect(activeDescription(runHandler, "sayHello")).toBe("from props");
    expect(runHandler.buildFrontendTools()).toEqual([
      {
        name: "sayHello",
        description: "from props",
        parameters: { type: "object", properties: {} },
      },
    ]);
  });

  it("makes the newest of two hook registrations active, and restores the first", () => {
    const runHandler = createRunHandler();
    runHandler.addTool({ name: "sayHello", description: "first" });
    const unregisterSecond = runHandler.addTool({
      name: "sayHello",
      description: "second",
    });

    expect(activeDescription(runHandler, "sayHello")).toBe("second");
    expect(runHandler.tools).toHaveLength(1);

    unregisterSecond();

    expect(activeDescription(runHandler, "sayHello")).toBe("first");
    expect(runHandler.tools).toHaveLength(1);
  });

  it("keeps the newest registration active when an older one is removed first", () => {
    const runHandler = createRunHandler();
    runHandler.initialize([{ name: "sayHello", description: "from props" }]);
    const unregisterFirst = runHandler.addTool({
      name: "sayHello",
      description: "first",
    });
    const unregisterSecond = runHandler.addTool({
      name: "sayHello",
      description: "second",
    });

    unregisterFirst();
    expect(activeDescription(runHandler, "sayHello")).toBe("second");

    unregisterSecond();
    expect(activeDescription(runHandler, "sayHello")).toBe("from props");
  });

  it("removes only its own registration when the same tool object is added twice", () => {
    const runHandler = createRunHandler();
    const tool = { name: "sayHello", description: "shared object" };
    const unregisterFirst = runHandler.addTool(tool);
    runHandler.addTool(tool);

    unregisterFirst();
    unregisterFirst();

    expect(activeDescription(runHandler, "sayHello")).toBe("shared object");
  });

  it("warns once per shadowing hook registration, and not for a provider tool", () => {
    const runHandler = createRunHandler();
    runHandler.initialize([
      {
        name: "sayHello",
        description: "from props",
        parameters: z.object({}),
      },
    ]);
    const parameters = z.object({});

    runHandler.addTool({ name: "sayHello", description: "first", parameters });
    expect(warn).not.toHaveBeenCalled();

    runHandler.addTool({ name: "sayHello", description: "second", parameters });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      "Tool already exists: 'sayHello' for agent 'global'",
    );
  });

  it("returns a new merged tools array after a registration is removed", () => {
    const runHandler = createRunHandler();
    runHandler.initialize([{ name: "providerTool", description: "p" }]);
    const unregister = runHandler.addTool({
      name: "hookTool",
      description: "h",
    });
    const withHookTool = runHandler.tools;

    unregister();

    expect(runHandler.tools).not.toBe(withHookTool);
    expect(runHandler.tools.map((tool) => tool.name)).toEqual(["providerTool"]);
  });

  it("removeTool removes every registration of the key and the provider tool", () => {
    const runHandler = createRunHandler();
    runHandler.initialize([{ name: "sayHello", description: "from props" }]);
    const unregisterFirst = runHandler.addTool({
      name: "sayHello",
      description: "first",
    });
    runHandler.addTool({ name: "sayHello", description: "second" });

    runHandler.removeTool("sayHello");
    expect(activeDescription(runHandler, "sayHello")).toBeUndefined();

    // A stale unregister after removeTool must not resurrect anything.
    unregisterFirst();
    expect(runHandler.tools).toHaveLength(0);
  });
});

/**
 * A wildcard tool is a local catch-all handler (see `executeWildcardTool`), not
 * something the model can call. Advertising it would offer the agent a tool
 * literally named `*`.
 */
describe("RunHandler wildcard tools are never advertised (#1746)", () => {
  it("omits the wildcard tool from buildFrontendTools", () => {
    const runHandler = createRunHandler();
    runHandler.initialize([
      { name: "chart", description: "c" },
      { name: "*", description: "catch-all" },
    ]);

    expect(runHandler.buildFrontendTools().map((t) => t.name)).toEqual([
      "chart",
    ]);
  });

  it("omits a wildcard tool registered through addTool", () => {
    const runHandler = createRunHandler();
    runHandler.addTool({ name: "*", description: "catch-all" });

    expect(runHandler.buildFrontendTools()).toHaveLength(0);
    // ...but it stays resolvable for local execution.
    expect(runHandler.getTool({ toolName: "*" })?.description).toBe(
      "catch-all",
    );
  });
});
