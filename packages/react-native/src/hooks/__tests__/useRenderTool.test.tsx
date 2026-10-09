import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
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

/**
 * `useRenderTool` on `@copilotkit/react-native` IS react-core's
 * `useRenderTool` — a plain re-export from `src/headless.ts`, with no RN
 * implementation behind it. That wiring is asserted structurally in
 * `src/__tests__/headless-entry-surface.test.ts`; this file asserts the
 * BEHAVIOUR a React Native consumer gets through that entry.
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
 * registered a frontend tool literally named `*`.
 *
 * Core never OFFERED that tool to the model: `buildFrontendTools` filters the
 * name out of the list it hands the agent. What the registration did instead is
 * claim core's catch-all HANDLER slot. When a tool call has no matching
 * frontend tool and no result yet, core reaches for the `*` tool and runs
 * `executeWildcardTool`, whose tool-result splice and follow-up return sit
 * OUTSIDE its `if (wildcardTool?.handler)` guard. So a display-only wildcard —
 * the thing the old hook's users were writing — auto-answered every
 * otherwise-unanswered tool call with an EMPTY tool result and asked for
 * another turn.
 *
 * PR #6533 converged the name onto react-core behind a temporary routing shim;
 * #6976 removed the shim. So the assertions below are the properties that would
 * silently regress if a local implementation ever re-grew under this name: the
 * wildcard must register no TOOL, only a renderer, and a named renderer must
 * land in CORE's registry and advertise nothing.
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
    // `useFrontendTool`, so `name: "*"` became a real frontend tool called `*` —
    // which is core's catch-all HANDLER name. Core never advertised it, but the
    // registration made core auto-answer every otherwise-unanswered tool call
    // with an empty tool result and request a follow-up turn.
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

    // THESE TWO are the discriminating assertions: the tool REGISTRY is what
    // the old hook actually polluted, so they are what fails if this route
    // ever forwards to `useFrontendTool` again, the way the alias did.
    expect(core.getTool({ toolName: "*" })).toBeUndefined();
    expect(core.tools.map((t) => t.name)).not.toContain("*");

    // The advertisement check below is a FORWARD GUARD, not a regression test.
    // It cannot fail for the old defect: core's `buildFrontendTools` already
    // filters `*` out of the advertised list, so `origin/main`'s hook — which
    // did register the tool — recorded `[[]]` here too. What this pins is that
    // nobody later makes `*` advertisable.
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

// ─── The renderer-only registration path ─────────────────────────────────────

/** The renderer-only shape: a schema and a renderer, no tool fields. */
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

describe("a renderer-only registration through RN's entry", () => {
  it("lands the renderer in CopilotKitCoreReact's registry and advertises nothing", async () => {
    // Also the behavioural half of the "RN owns no registry" guard: a
    // registration made through RN's entry has to end up in CORE's registry,
    // which is the property an RN-local registry (RN once had one) would break
    // while every export-surface check stayed green.
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
