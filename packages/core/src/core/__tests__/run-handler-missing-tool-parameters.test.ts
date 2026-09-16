import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { RunHandler } from "../run-handler";
import type { CopilotKitCore } from "../core";

function createRunHandler(): RunHandler {
  return new RunHandler({} as CopilotKitCore);
}

function missingParameterWarnings(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls
    .map((call) => String(call[0]))
    .filter((message) => message.includes("no parameters schema"));
}

/**
 * PE-109: a tool registered without a `parameters` schema is advertised to the
 * model as `{ type: "object", properties: {} }` — an object with nothing to
 * fill in — and `createToolSchema` substitutes that constant silently.
 * `parameters` is optional on `FrontendTool`, so the compiler says nothing
 * either. The model then calls the tool with no arguments and the developer has
 * no signal that the schema, not the model, is the reason.
 *
 * `useComponent`, `useFrontendTool` and `useHumanInTheLoop` all funnel into
 * `core.addTool()` -> `RunHandler.addTool`, and the provider's `tools` prop
 * funnels into `initialize`/`setTools`, so the warning lives on the registry
 * writes rather than in any one hook.
 */
describe("RunHandler missing-parameters warning (PE-109)", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("warns when addTool registers a tool with no parameters schema", () => {
    const runHandler = createRunHandler();

    runHandler.addTool({ name: "sayHello", description: "from a hook" });

    const warnings = missingParameterWarnings(warn);
    expect(warnings).toHaveLength(1);
    // Names the offending tool and says what to do about it.
    expect(warnings[0]).toContain("'sayHello'");
    expect(warnings[0]).toContain("parameters");
  });

  /**
   * The warning tells developers to write `parameters: z.object({})` when a
   * tool takes no arguments on purpose. That advice is only worth giving if the
   * empty schema actually silences the warning, so assert it directly rather
   * than inferring it from the truthiness of `tool.parameters`.
   */
  it("stays silent for a tool that declares an empty parameters schema", () => {
    const runHandler = createRunHandler();

    runHandler.addTool({
      name: "confirm",
      description: "takes no arguments on purpose",
      parameters: z.object({}),
    });

    expect(missingParameterWarnings(warn)).toHaveLength(0);
  });

  /**
   * The empty schema is only a free silencer if it advertises the same thing to
   * the model as omitting `parameters` does. If `createToolSchema` ever stopped
   * reducing `z.object({})` to the bare empty-object schema, the advice in the
   * warning would be telling developers to change the wire format.
   */
  it("advertises the same schema for z.object({}) as for an omitted parameters", () => {
    const omitted = createRunHandler();
    omitted.initialize([{ name: "confirm", description: "no schema" }]);

    const explicit = createRunHandler();
    explicit.initialize([
      {
        name: "confirm",
        description: "empty schema",
        parameters: z.object({}),
      },
    ]);

    const omittedSchema = omitted.buildFrontendTools()[0]!.parameters;
    const explicitSchema = explicit.buildFrontendTools()[0]!.parameters;

    expect(explicitSchema).toEqual(omittedSchema);
    expect(explicitSchema).toEqual({ type: "object", properties: {} });
  });

  /**
   * A developer who deliberately wrote a zero-argument tool needs to be told how
   * to say so, not only how to add arguments. Pin both halves of the advice so
   * one cannot be dropped while the other survives.
   */
  it("names both the add-arguments and the takes-none paths", () => {
    const runHandler = createRunHandler();

    runHandler.addTool({ name: "sayHello", description: "from a hook" });

    const warnings = missingParameterWarnings(warn);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("if it should receive arguments");
    expect(warnings[0]).toContain("z.object({})");
  });

  it("stays silent for a tool that declares parameters", () => {
    const runHandler = createRunHandler();

    runHandler.addTool({
      name: "sayHello",
      description: "from a hook",
      parameters: z.object({ name: z.string() }),
    });

    expect(missingParameterWarnings(warn)).toHaveLength(0);
  });

  /**
   * `useFrontendTool` re-runs its layout effect on every dependency change and
   * tears down with `removeTool` before re-registering. Without deduplication
   * that is one warning per render, which is noise developers mute.
   */
  it("warns once per tool across repeated re-registration", () => {
    const runHandler = createRunHandler();

    for (let i = 0; i < 5; i++) {
      runHandler.removeTool("sayHello");
      runHandler.addTool({ name: "sayHello", description: "from a hook" });
    }

    expect(missingParameterWarnings(warn)).toHaveLength(1);
  });

  it("warns for provider tools and not again on a provider re-sync", () => {
    const runHandler = createRunHandler();

    runHandler.initialize([
      { name: "providerTool", description: "from props" },
    ]);
    runHandler.setTools([{ name: "providerTool", description: "from props" }]);
    runHandler.setTools([{ name: "providerTool", description: "from props" }]);

    const warnings = missingParameterWarnings(warn);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("'providerTool'");
  });

  it("reports a global and an agent-scoped tool of the same name separately", () => {
    const runHandler = createRunHandler();

    runHandler.addTool({ name: "dup", description: "global" });
    runHandler.addTool({ name: "dup", description: "scoped", agentId: "a" });

    expect(missingParameterWarnings(warn)).toHaveLength(2);
  });

  it("does not warn in production builds", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const runHandler = createRunHandler();
      runHandler.addTool({ name: "sayHello", description: "from a hook" });
      expect(missingParameterWarnings(warn)).toHaveLength(0);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  /**
   * The existing duplicate-name guard short-circuits `addTool`. A registration
   * that never lands must not produce a warning about its schema.
   */
  it("does not warn for a registration the duplicate guard rejects", () => {
    const runHandler = createRunHandler();

    runHandler.addTool({
      name: "sayHello",
      description: "first",
      parameters: z.object({ name: z.string() }),
    });
    runHandler.addTool({ name: "sayHello", description: "second" });

    expect(missingParameterWarnings(warn)).toHaveLength(0);
  });
});
