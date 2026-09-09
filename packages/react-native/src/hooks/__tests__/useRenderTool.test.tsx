import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { AbstractAgent } from "@ag-ui/client";
import type { RunAgentParameters, RunAgentResult } from "@ag-ui/client";

import {
  useCopilotKit,
  useRenderTool,
  useRenderToolCall,
} from "../../headless";
import type { CopilotKitContextValue } from "../../headless";
import { TestCopilotKit } from "../../__mocks__/test-copilotkit";
import { __resetRenderToolShimWarnings } from "../useRenderTool";

/**
 * `useRenderTool` on `@copilotkit/react-native` is a DEPRECATED COMPATIBILITY
 * SHIM over react-core's two hooks (`src/hooks/useRenderTool.ts`), scheduled
 * for removal in the next minor. It registers nothing itself — every route
 * delegates — and the delegation is asserted structurally in
 * `src/__tests__/headless-entry-surface.test.ts` and behaviourally here.
 *
 * ─── What this file is for ───────────────────────────────────────────────────
 *
 * RN previously shipped a local `useRenderTool` whose entire body forwarded to
 * react-core's `useFrontendTool` — core's OTHER hook, wearing this one's name.
 * The two are not interchangeable, and the difference is exactly what a
 * consumer gets billed for: `useFrontendTool` registers a TOOL (advertised to
 * the model, callable by it) alongside its renderer, while `useRenderTool`
 * registers a RENDERER ONLY. Under the alias, `name: "*"` — the documented way
 * to spell "decorate every tool call that has no renderer of its own" —
 * registered a frontend tool literally named `*` and offered it to the model.
 *
 * So the assertions below are about which core hook a given call shape reaches,
 * and about the two properties that would silently regress if a local
 * implementation ever re-grew under this name: the wildcard registers no tool,
 * and a render-only registration advertises nothing.
 *
 * ─── Why nothing here is mocked ──────────────────────────────────────────────
 *
 * An earlier version of this suite mocked `useFrontendTool`, and the double it
 * substituted modelled only `name`/`render`. Deleting whole fields from the
 * hook under test left it fully green. Everything here therefore drives a REAL
 * `CopilotKitCoreReact` through `TestCopilotKit` and asserts on core's own
 * observable behaviour — what `getTool` resolves, what `runTool` executes, what
 * core advertises on a run, what actually paints — never on a mock's call
 * arguments. A hook that registered nothing at all could satisfy a mock; it
 * cannot satisfy these.
 */

type Core = CopilotKitContextValue["copilotkit"];

/** Publishes the live core instance so a test can drive it directly. */
function CaptureCore({
  into,
}: {
  into: { current: Core | null };
}): React.ReactElement | null {
  const { copilotkit } = useCopilotKit();
  into.current = copilotkit;
  return null;
}

/**
 * Records the tool list core advertises on each run.
 *
 * "Advertised" is the claim that matters for a render-only registration, and it
 * is not the same observation as "present in the registry": core builds the
 * wire-level list inside `RunHandler.runAgent` (`buildFrontendTools`), which is
 * private to core, so the only consumer-reachable vantage point is the agent's
 * own `runAgent` input. Overriding `runAgent` (rather than `run`) stops the run
 * at exactly that boundary: the input has been built, and no transport, event
 * stream or follow-up turn is needed to read it.
 */
class ToolListRecordingAgent extends AbstractAgent {
  readonly advertised: string[][] = [];

  async runAgent(parameters?: RunAgentParameters): Promise<RunAgentResult> {
    this.advertised.push((parameters?.tools ?? []).map((tool) => tool.name));
    return { result: undefined, newMessages: [] };
  }

  run(): ReturnType<AbstractAgent["run"]> {
    throw new Error("ToolListRecordingAgent.run() is not used in tests");
  }
}

/** The single tool name each `render` call is asked to paint. */
const renderOneCall = (name: string, args = "{}") => ({
  toolCall: {
    id: "tc-1",
    type: "function" as const,
    function: { name, arguments: args },
  },
});

// ─── The wildcard renderer ────────────────────────────────────────────────────

/**
 * Registers `"*"` and paints one tool call of the caller's choosing, so a test
 * can name a tool NOBODY registered a renderer for and still see output.
 */
function WildcardProbe({ paints }: { paints: string }) {
  useRenderTool(
    {
      name: "*",
      render: ({ name, status }) => <>{`wildcard|${name}|${status}`}</>,
    },
    [],
  );
  const renderToolCall = useRenderToolCall();
  return <>{renderToolCall(renderOneCall(paints))}</>;
}

describe("the wildcard renderer, registered through RN's entry", () => {
  it("paints for a tool call that has no exact-name renderer", async () => {
    const { container } = render(
      <TestCopilotKit messages={[]}>
        <WildcardProbe paints="somethingNobodyRegistered" />
      </TestCopilotKit>,
    );

    // Registration happens in an effect, so the first paint predates it; the
    // renderer-registry subscription is what brings the text in.
    await waitFor(() =>
      expect(container.textContent).toBe(
        "wildcard|somethingNobodyRegistered|inProgress",
      ),
    );
  });

  it("registers NO frontend tool named `*`", async () => {
    // The defect this exists for. RN's deleted hook forwarded to
    // `useFrontendTool`, so `name: "*"` became a real frontend tool called `*`:
    // core advertised it on every run, and a model that took the offer would
    // call a tool whose name is a glob and whose schema is nothing.
    const coreRef: { current: Core | null } = { current: null };
    const agent = new ToolListRecordingAgent();

    render(
      <TestCopilotKit messages={[]} agent={agent}>
        <CaptureCore into={coreRef} />
        <WildcardProbe paints="somethingNobodyRegistered" />
      </TestCopilotKit>,
    );
    const core = coreRef.current!;

    // Wait for the registration itself, so the assertions below are about a
    // registered wildcard rather than about an effect that has not run yet.
    await waitFor(() =>
      expect(core.renderToolCalls.map((r) => r.name)).toContain("*"),
    );

    expect(core.getTool({ toolName: "*" })).toBeUndefined();
    expect(core.tools.map((t) => t.name)).not.toContain("*");

    // …and the same thing observed one layer out, where it would actually hurt:
    // the tool list core hands the agent for a real run.
    await act(async () => {
      await core.runAgent({ agent });
    });
    // Spelled as the whole recording rather than as `not.toContain("*")`: the
    // latter also passes when no run happened at all, and nothing else here
    // registers a tool, so the exact expectation is one run advertising nothing.
    expect(agent.advertised).toEqual([[]]);
  });
});

// ─── A render-only registration ───────────────────────────────────────────────

/**
 * Registers a renderer for `searchDocs` and paints a `searchDocs` call.
 *
 * `searchDocs` stands for a tool the SERVER owns: the frontend supplies its UI
 * and nothing else. Nothing in this component registers a handler, and there is
 * deliberately no way to — that is the hook's contract.
 */
function ServerToolProbe() {
  useRenderTool(
    {
      name: "searchDocs",
      parameters: z.object({ query: z.string() }),
      render: ({ status, parameters }) => (
        <>{`${status}|${parameters.query ?? ""}`}</>
      ),
    },
    [],
  );
  const renderToolCall = useRenderToolCall();
  return (
    <>{renderToolCall(renderOneCall("searchDocs", '{"query":"invoices"}'))}</>
  );
}

describe("a render-only registration", () => {
  it("does not produce a callable tool", async () => {
    const coreRef: { current: Core | null } = { current: null };

    render(
      <TestCopilotKit messages={[]}>
        <CaptureCore into={coreRef} />
        <ServerToolProbe />
      </TestCopilotKit>,
    );
    const core = coreRef.current!;

    await waitFor(() =>
      expect(core.renderToolCalls.map((r) => r.name)).toContain("searchDocs"),
    );

    expect(core.getTool({ toolName: "searchDocs" })).toBeUndefined();
    // Asserted through core's real execution path, not just the lookup: a tool
    // that resolves but cannot run, and one that was never registered, are
    // different failures and only this tells them apart.
    await expect(
      core.runTool({ name: "searchDocs", parameters: { query: "invoices" } }),
    ).rejects.toThrow("Tool not found: searchDocs");
  });

  it("does not shadow a same-named server tool — it paints the call and advertises nothing", async () => {
    // The two halves of "not shadowing", together. If registering a renderer
    // also registered a tool, the client would claim `searchDocs` on the wire
    // and the runtime would route the call to a frontend handler that does not
    // exist, instead of to the server tool that owns the name.
    const coreRef: { current: Core | null } = { current: null };
    const agent = new ToolListRecordingAgent();

    const { container } = render(
      <TestCopilotKit messages={[]} agent={agent}>
        <CaptureCore into={coreRef} />
        <ServerToolProbe />
      </TestCopilotKit>,
    );
    const core = coreRef.current!;

    // Half one: the server's call still gets the frontend's UI.
    await waitFor(() =>
      expect(container.textContent).toBe("inProgress|invoices"),
    );

    // Half two: nothing named `searchDocs` goes out with the run.
    await act(async () => {
      await core.runAgent({ agent });
    });
    expect(agent.advertised).toEqual([[]]);
  });
});

// ─── agentId on a render-only registration ────────────────────────────────────

/** Registers an `escalate` renderer scoped to `support`, then paints `escalate`. */
function ScopedProbe() {
  useRenderTool(
    {
      name: "escalate",
      parameters: z.object({ reason: z.string() }),
      agentId: "support",
      render: ({ name }) => <>{`scoped|${name}`}</>,
    },
    [],
  );
  const renderToolCall = useRenderToolCall();
  return <>{renderToolCall(renderOneCall("escalate"))}</>;
}

describe("agentId on a render-only registration", () => {
  it("PINS the limitation: a scoped renderer still paints under a different agent", async () => {
    // `agentId` keys the renderer entry (`${agentId}:${name}`) so a scoped and a
    // global renderer of the same name can coexist — but RESOLUTION does not
    // enforce it: `useRenderToolCall` prefers an agentId match and then falls
    // back to any same-named entry, deliberately ("we show all tool calls
    // regardless of agentId"). Here the only `escalate` renderer is scoped to
    // `support` while the chat resolves under the default agent, and it paints
    // anyway.
    //
    // Pinned rather than fixed, and stated as a LIMITATION rather than as
    // scoping: the predecessor of this test was named for the scoping claim,
    // checked `getTool` and `renderer.agentId` instead, and so asserted the
    // opposite of the behaviour while staying green.
    const coreRef: { current: Core | null } = { current: null };

    const { container } = render(
      <TestCopilotKit messages={[]}>
        <CaptureCore into={coreRef} />
        <ScopedProbe />
      </TestCopilotKit>,
    );

    await waitFor(() => expect(container.textContent).toBe("scoped|escalate"));

    // The scoping that IS real: the entry records the agent it was filed under.
    const renderer = coreRef.current!.renderToolCalls.find(
      (r) => r.name === "escalate",
    );
    expect(renderer?.agentId).toBe("support");
  });
});

// ─── The routing rules of the compatibility shim ──────────────────────────────

/**
 * The three rules `src/hooks/useRenderTool.ts` implements, each asserted on
 * core's OWN observable state rather than on a spy's call arguments:
 *
 *   1. `name === "*"` wins UNCONDITIONALLY -> core's `useRenderTool`
 *      (renderer-only, wildcard path), whatever else was supplied.
 *   2. otherwise `handler` or `description` present -> core's `useFrontendTool`
 *      (tool AND renderer), which is what the old RN hook actually did.
 *   3. otherwise -> core's `useRenderTool`.
 *
 * Rule 1 is the load-bearing one and it is deliberately not the obvious
 * reading. The old RN hook made `description` REQUIRED, so every wildcard
 * renderer anyone ever wrote carries the old tool fields; routing "has old
 * fields" to `useFrontendTool` would recreate the `*`-named-tool bug for exactly
 * the people who had tried hardest to use the wildcard.
 *
 * Each probe uses a tool name no other test in this file uses, because the
 * shim's deprecation warning is deduped per tool name for the lifetime of the
 * module.
 */

/**
 * Rule 1: a wildcard call carrying the OLD tool fields — the only shape the old
 * hook's required `description` allowed.
 */
function LegacyWildcardProbe({ paints }: { paints: string }) {
  useRenderTool(
    {
      name: "*",
      description: "renders every tool call nothing else claims",
      parameters: z.object({ anything: z.string() }),
      handler: async () => "should never be registered, let alone run",
      render: ({ name, status }) => <>{`legacy-wildcard|${name}|${status}`}</>,
    },
    [],
  );
  const renderToolCall = useRenderToolCall();
  return <>{renderToolCall(renderOneCall(paints))}</>;
}

describe('rule 1: `name: "*"` wins unconditionally', () => {
  it("paints as a fallback renderer and registers NO tool named `*`", async () => {
    // The regression rule 1 exists to prevent. Under the old hook this exact
    // call shape registered a frontend tool literally named `*` and advertised
    // it on every run.
    const coreRef: { current: Core | null } = { current: null };
    const agent = new ToolListRecordingAgent();

    const { container } = render(
      <TestCopilotKit messages={[]} agent={agent}>
        <CaptureCore into={coreRef} />
        <LegacyWildcardProbe paints="someServerToolNobodyClaimed" />
      </TestCopilotKit>,
    );
    const core = coreRef.current!;

    // Half one: it still paints, as a FALLBACK — the tool call it renders has
    // no renderer of its own.
    await waitFor(() =>
      expect(container.textContent).toBe(
        "legacy-wildcard|someServerToolNobodyClaimed|inProgress",
      ),
    );
    expect(core.renderToolCalls.map((r) => r.name)).toContain("*");

    // Half two: nothing named `*` is a tool, in the registry or on the wire.
    expect(core.getTool({ toolName: "*" })).toBeUndefined();
    expect(core.tools.map((t) => t.name)).not.toContain("*");
    await act(async () => {
      await core.runAgent({ agent });
    });
    expect(agent.advertised).toEqual([[]]);
  });
});

/**
 * Rule 2: the old tool-plus-renderer shape, under a real name.
 *
 * `handler` returns a value the test can observe through core's own execution
 * path, because "the handler never runs again" is the silent half of the break
 * this shim exists for.
 */
function LegacyToolProbe() {
  useRenderTool(
    {
      name: "sendEmail",
      description: "Send an email on the user's behalf",
      parameters: z.object({ to: z.string() }),
      handler: async ({ to }) => `sent to ${to}`,
      render: ({ status, parameters }) => (
        <>{`legacy-tool|${status}|${parameters.to ?? ""}`}</>
      ),
    },
    [],
  );
  const renderToolCall = useRenderToolCall();
  return (
    <>{renderToolCall(renderOneCall("sendEmail", '{"to":"a@b.example"}'))}</>
  );
}

describe("rule 2: `handler`/`description` route to `useFrontendTool`", () => {
  it("registers a callable, advertised tool AND its renderer", async () => {
    const coreRef: { current: Core | null } = { current: null };
    const agent = new ToolListRecordingAgent();

    const { container } = render(
      <TestCopilotKit messages={[]} agent={agent}>
        <CaptureCore into={coreRef} />
        <LegacyToolProbe />
      </TestCopilotKit>,
    );
    const core = coreRef.current!;

    await waitFor(() =>
      expect(core.getTool({ toolName: "sendEmail" })).toBeDefined(),
    );

    // The tool half: present, described, advertised, and — the assertion that
    // separates "registered" from "works" — actually executable through core.
    expect(core.getTool({ toolName: "sendEmail" })?.description).toBe(
      "Send an email on the user's behalf",
    );
    expect(core.tools.map((t) => t.name)).toContain("sendEmail");
    await expect(
      core.runTool({ name: "sendEmail", parameters: { to: "a@b.example" } }),
    ).resolves.toMatchObject({
      result: "sent to a@b.example",
      error: undefined,
    });
    await act(async () => {
      await core.runAgent({ agent });
    });
    expect(agent.advertised).toEqual([["sendEmail"]]);

    // The renderer half: registered through the same call, and painting.
    expect(container.textContent).toBe("legacy-tool|inProgress|a@b.example");
  });
});

/** Rule 3: the new, renderer-only shape — no tool fields at all. */
function ModernRendererProbe() {
  useRenderTool(
    {
      name: "renderInvoice",
      parameters: z.object({ id: z.string() }),
      render: ({ status, parameters }) => (
        <>{`modern|${status}|${parameters.id ?? ""}`}</>
      ),
    },
    [],
  );
  const renderToolCall = useRenderToolCall();
  return (
    <>{renderToolCall(renderOneCall("renderInvoice", '{"id":"inv-7"}'))}</>
  );
}

describe("rule 3: no tool fields routes to core's `useRenderTool`", () => {
  it("lands the renderer in CopilotKitCoreReact's registry and advertises nothing", async () => {
    // Also the behavioural half of the delegation guard: a registration made
    // through RN's shim has to end up in CORE's registry, which is the property
    // an RN-local registry (RN once had one) would break while every
    // export-surface check stayed green.
    const coreRef: { current: Core | null } = { current: null };
    const agent = new ToolListRecordingAgent();

    const { container } = render(
      <TestCopilotKit messages={[]} agent={agent}>
        <CaptureCore into={coreRef} />
        <ModernRendererProbe />
      </TestCopilotKit>,
    );
    const core = coreRef.current!;

    await waitFor(() =>
      expect(core.renderToolCalls.map((r) => r.name)).toContain(
        "renderInvoice",
      ),
    );
    expect(container.textContent).toBe("modern|inProgress|inv-7");

    expect(core.getTool({ toolName: "renderInvoice" })).toBeUndefined();
    expect(core.tools.map((t) => t.name)).not.toContain("renderInvoice");
    await act(async () => {
      await core.runAgent({ agent });
    });
    expect(agent.advertised).toEqual([[]]);
  });
});

// ─── The deprecation warning ──────────────────────────────────────────────────

/**
 * A legacy tool-shaped call whose tool NAME the caller chooses, so each warning
 * test gets a name of its own — the warning is deduped per tool name for the
 * lifetime of the module, which is the property under test.
 */
function WarningProbe({ name }: { name: string }) {
  useRenderTool(
    {
      name,
      description: "a legacy tool-plus-renderer registration",
      parameters: z.object({ x: z.string() }),
      handler: async () => "ok",
      render: () => null,
    },
    [],
  );
  return null;
}

/**
 * A call whose SHAPE changes between renders — `handler`/`description` appear
 * only once `legacy` is true, which is what a `handler: enabled ? fn : undefined`
 * call site looks like from the shim's side.
 */
function ShapeShiftingProbe({ legacy }: { legacy: boolean }) {
  useRenderTool(
    {
      name: "shapeShifter",
      parameters: z.object({ x: z.string() }),
      render: () => null,
      ...(legacy
        ? { description: "now a tool as well", handler: async () => "ok" }
        : {}),
    },
    [],
  );
  return null;
}

describe("the shim's deprecation warning", () => {
  // The dedup key is the tool NAME and it lives as long as the module, so
  // without this the wildcard's warning (always `"*"`) would already have been
  // consumed by the rule-1 test above and these tests would have to depend on
  // file order to observe anything.
  beforeEach(() => {
    __resetRenderToolShimWarnings();
  });

  it("fires once per distinct tool name, not once per render", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { rerender, unmount } = render(
        <TestCopilotKit messages={[]}>
          <WarningProbe name="warnOnceTool" />
        </TestCopilotKit>,
      );
      await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));

      // Re-render the same tree several times. A warning emitted from the
      // render path — or keyed on anything per-render — shows up here as a
      // growing count.
      for (let i = 0; i < 3; i++) {
        rerender(
          <TestCopilotKit messages={[]}>
            <WarningProbe name="warnOnceTool" />
          </TestCopilotKit>,
        );
      }
      await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));

      // Then MOUNT IT AGAIN, which is what makes the module-level dedup set the
      // load-bearing part rather than the effect's dependency array: a fresh
      // mount runs a fresh effect. On a real device this is navigating back to
      // a screen, and re-warning there would put the notice in a loop.
      unmount();
      render(
        <TestCopilotKit messages={[]}>
          <WarningProbe name="warnOnceTool" />
        </TestCopilotKit>,
      );
      await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));

      const message = String(warn.mock.calls[0]![0]);
      // What was received, which hook it was routed to, and what to change the
      // call to — a warning that says less than that is not actionable.
      expect(message).toContain("[CopilotKit]");
      expect(message).toContain("warnOnceTool");
      expect(message).toContain("`description`");
      expect(message).toContain("`handler`");
      expect(message).toContain("`useFrontendTool`");
      expect(message).toContain("removal in the next minor");
    } finally {
      warn.mockRestore();
    }
  });

  it("names the fields a wildcard call ignored, and says no `*` tool is registered", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      render(
        <TestCopilotKit messages={[]}>
          <LegacyWildcardProbe paints="anything" />
        </TestCopilotKit>,
      );
      await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));

      const message = String(warn.mock.calls[0]![0]);
      expect(message).toContain("IGNORED");
      expect(message).toContain("`description`");
      expect(message).toContain("`handler`");
      expect(message).toContain("`parameters`");
      expect(message).toContain("RENDERER ONLY");
    } finally {
      warn.mockRestore();
    }
  });

  it("reports, rather than silently acts on, a config that changes shape mid-life", async () => {
    // The route is frozen at first render because a hook cannot be called
    // conditionally unless the condition is stable for the component's
    // lifetime. That is a real limitation, so it is stated out loud rather than
    // papered over: the registration stays where it started (renderer-only
    // here, so `shapeShifter` never becomes a tool) and the consumer is told to
    // call the hook they actually want.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const coreRef: { current: Core | null } = { current: null };
      const { rerender } = render(
        <TestCopilotKit messages={[]}>
          <CaptureCore into={coreRef} />
          <ShapeShiftingProbe legacy={false} />
        </TestCopilotKit>,
      );
      await waitFor(() =>
        expect(coreRef.current!.renderToolCalls.map((r) => r.name)).toContain(
          "shapeShifter",
        ),
      );
      // Rule 3 on the first render: nothing was supplied, nothing is warned.
      expect(warn).not.toHaveBeenCalled();

      rerender(
        <TestCopilotKit messages={[]}>
          <CaptureCore into={coreRef} />
          <ShapeShiftingProbe legacy />
        </TestCopilotKit>,
      );

      await waitFor(() => expect(warn).toHaveBeenCalled());
      const messages = warn.mock.calls.map((call) => String(call[0]));
      expect(
        messages.some((m) => m.includes("changed shape between renders")),
      ).toBe(true);
      // And the frozen route is the observable consequence: still no tool.
      expect(
        coreRef.current!.getTool({ toolName: "shapeShifter" }),
      ).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });

  it("is silent in production", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const coreRef: { current: Core | null } = { current: null };
      render(
        <TestCopilotKit messages={[]}>
          <CaptureCore into={coreRef} />
          <WarningProbe name="productionSilentTool" />
        </TestCopilotKit>,
      );
      // Wait for the REGISTRATION rather than for a timeout: the claim is
      // "routed and silent", and a test that only waited for silence would pass
      // just as well if the hook had done nothing at all.
      await waitFor(() =>
        expect(
          coreRef.current!.getTool({ toolName: "productionSilentTool" }),
        ).toBeDefined(),
      );
      expect(warn).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = previous;
      warn.mockRestore();
    }
  });
});
