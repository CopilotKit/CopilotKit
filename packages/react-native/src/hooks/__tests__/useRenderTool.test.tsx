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
 * `useRenderTool` on `@copilotkit/react-native` IS react-core's hook — this
 * package has no render-tool implementation of its own any more, and the
 * identity of the re-export is asserted in
 * `src/__tests__/headless-entry-surface.test.ts`.
 *
 * ─── What this file is for, now that RN owns no code here ────────────────────
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
 * So the assertions below are not about RN's forwarding (there is none left to
 * forward, and core covers its own hook upstream). They pin the two properties
 * that would silently regress if a local hook ever re-grew under this name:
 * the wildcard registers no tool, and a render-only registration advertises
 * nothing.
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
