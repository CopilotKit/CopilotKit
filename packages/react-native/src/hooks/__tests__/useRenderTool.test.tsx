import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

import { useRenderTool } from "../useRenderTool";
import { useCopilotKit, useRenderToolCall } from "../../headless";
import type { CopilotKitContextValue } from "../../headless";
import { TestCopilotKit } from "../../__mocks__/test-copilotkit";

/**
 * `useRenderTool` is a THIN FORWARDER: every field it accepts is handed to
 * react-core's `useFrontendTool`, and every behaviour it claims is really that
 * hook's behaviour. So this suite must not mock `useFrontendTool` — an earlier
 * version did, and the double it substituted only modelled `name`/`render`.
 * Deleting the `deps`, `handler` and `agentId` forwarding from the hook left
 * that suite fully green: it could not detect a regression in any of the three
 * things the hook exists to forward.
 *
 * Everything here therefore drives a REAL `CopilotKitCoreReact` through
 * `TestCopilotKit` (as the sibling `render-tool-call.integration.test.tsx`
 * does) and asserts on core's own observable behaviour — what `runTool`
 * executes, what `getTool` resolves, what actually paints — rather than on a
 * mock's call arguments.
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

// ─── Registration basics ──────────────────────────────────────────────────────

describe("useRenderTool", () => {
  it("registers the tool with react-core, name/description/schema intact", () => {
    const coreRef: { current: Core | null } = { current: null };
    const schema = z.object({ query: z.string() });

    function Probe() {
      useRenderTool({
        name: "searchLedger",
        description: "Search the ledger",
        parameters: schema,
        render: () => null,
      });
      return null;
    }

    render(
      <TestCopilotKit messages={[]}>
        <CaptureCore into={coreRef} />
        <Probe />
      </TestCopilotKit>,
    );

    const tool = coreRef.current!.getTool({ toolName: "searchLedger" });
    expect(tool).toBeDefined();
    expect(tool!.description).toBe("Search the ledger");
    expect(tool!.parameters).toBe(schema);
  });
});

describe("useRenderTool registry target", () => {
  it("registers its renderer into core's renderToolCalls, not a local map", () => {
    // The whole point of the convergence: one registry. react-core's
    // useRenderToolCall reads copilotkit.renderToolCalls, so a renderer that
    // does not land there renders nowhere outside RN's own chat.
    const coreRef: { current: Core | null } = { current: null };

    function Probe() {
      useRenderTool({
        name: "showWeather",
        description: "Show weather",
        parameters: z.object({ city: z.string() }),
        render: () => null,
      });
      return null;
    }

    render(
      <TestCopilotKit messages={[]}>
        <CaptureCore into={coreRef} />
        <Probe />
      </TestCopilotKit>,
    );

    expect(coreRef.current!.renderToolCalls.map((r) => r.name)).toContain(
      "showWeather",
    );
  });
});

// ─── Forwarded concern: handler ───────────────────────────────────────────────

describe("useRenderTool forwards handler", () => {
  it("runs the caller's handler when core executes the tool", async () => {
    // Observed through core's real execution path (`runTool` → the same
    // `executeToolHandler` an LLM-driven turn uses), not by inspecting the
    // registered object: a handler that is registered but never reached is
    // indistinguishable from a missing one to the app.
    const coreRef: { current: Core | null } = { current: null };
    const handler = vi.fn(
      async (args: { city: string }) => `sunny in ${args.city}`,
    );

    function Probe() {
      useRenderTool({
        name: "getWeather",
        description: "Get weather",
        parameters: z.object({ city: z.string() }),
        render: () => null,
        handler,
      });
      return null;
    }

    render(
      <TestCopilotKit messages={[]}>
        <CaptureCore into={coreRef} />
        <Probe />
      </TestCopilotKit>,
    );

    let outcome: Awaited<ReturnType<Core["runTool"]>> | undefined;
    await act(async () => {
      outcome = await coreRef.current!.runTool({
        name: "getWeather",
        parameters: { city: "Berlin" },
      });
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0]).toEqual({ city: "Berlin" });
    // Core writes the handler's return value into the tool result. Drop the
    // forwarding and this is the empty string a handler-less tool produces.
    expect(outcome!.result).toBe("sunny in Berlin");
  });
});

// ─── Forwarded concern: agentId ───────────────────────────────────────────────

describe("useRenderTool forwards agentId", () => {
  it("scopes the tool and its renderer to that agent, not globally", () => {
    const coreRef: { current: Core | null } = { current: null };

    function Probe() {
      useRenderTool({
        name: "escalate",
        description: "Escalate to a human",
        parameters: z.object({ reason: z.string() }),
        render: () => null,
        agentId: "support",
      });
      return null;
    }

    render(
      <TestCopilotKit messages={[]}>
        <CaptureCore into={coreRef} />
        <Probe />
      </TestCopilotKit>,
    );

    const core = coreRef.current!;

    // Reachable for the agent it was scoped to …
    expect(
      core.getTool({ toolName: "escalate", agentId: "support" }),
    ).toBeDefined();

    // … and NOT as a global tool. This is the assertion that bites: core's
    // `getTool` falls back to global tools only when `tool.agentId` is unset,
    // so a dropped agentId turns a scoped tool into one every agent can call.
    expect(core.getTool({ toolName: "escalate" })).toBeUndefined();

    // The renderer half is keyed `${agentId}:${name}`, which is what lets a
    // scoped renderer coexist with a global one of the same name.
    const renderer = core.renderToolCalls.find((r) => r.name === "escalate");
    expect(renderer).toBeDefined();
    expect(renderer!.agentId).toBe("support");
  });
});

// ─── Forwarded concern: deps ──────────────────────────────────────────────────

/**
 * Paints whatever `label` the renderer captured at registration time, through
 * react-core's real `useRenderToolCall`. The render closure is deliberately
 * stale-able: `useFrontendTool` captures it in an effect, so the painted text
 * only changes when that effect re-runs.
 */
function LabelProbe({
  label,
  deps,
}: {
  label: string;
  deps: ReadonlyArray<unknown>;
}) {
  useRenderTool(
    {
      name: "showLabel",
      description: "Show a label",
      parameters: z.object({}),
      render: () => <>{label}</>,
    },
    deps,
  );
  const renderToolCall = useRenderToolCall();
  return (
    <>
      {renderToolCall({
        toolCall: {
          id: "tc-label",
          type: "function",
          function: { name: "showLabel", arguments: "{}" },
        },
      })}
    </>
  );
}

/**
 * A dep array holding a FRESH function identity on every call. `JSON.stringify`
 * flattens it to the constant `"[null]"`, so `useFrontendTool` can never see it
 * change however often the caller re-renders.
 */
const freshNonSerialisableDeps = (): ReadonlyArray<unknown> => [
  () => "callback",
];

describe("useRenderTool forwards deps", () => {
  it("re-registers the render closure when a dep changes", async () => {
    // The hook's own JSDoc promises exactly this: values a render closes over
    // must be passed in `deps` or the chat keeps painting the stale closure.
    // Without the forwarding, `useFrontendTool` sees an empty dep array, its
    // effect never re-runs, and "before" is painted forever.
    const { container, rerender } = render(
      <TestCopilotKit messages={[]}>
        <LabelProbe label="before" deps={["before"]} />
      </TestCopilotKit>,
    );

    await waitFor(() => expect(container.textContent).toBe("before"));

    rerender(
      <TestCopilotKit messages={[]}>
        <LabelProbe label="after" deps={["after"]} />
      </TestCopilotKit>,
    );

    await waitFor(() => expect(container.textContent).toBe("after"));
  });

  it("PINS the limitation: a non-serialisable dep can never re-register", async () => {
    // `useFrontendTool` compares deps with `JSON.stringify(extraDeps)`, so a
    // function / Map / Set / private-field class instance collapses to a
    // CONSTANT and cannot trigger re-registration however often its identity
    // changes. This is a documented sharp edge, not a bug to fix here — it is
    // pinned so that changing the comparator (e.g. to reference equality) fails
    // loudly and forces the hook's JSDoc to be updated with it.
    const coreRef: { current: Core | null } = { current: null };

    const { container, rerender } = render(
      <TestCopilotKit messages={[]}>
        <CaptureCore into={coreRef} />
        <LabelProbe label="before" deps={freshNonSerialisableDeps()} />
      </TestCopilotKit>,
    );

    await waitFor(() => expect(container.textContent).toBe("before"));
    const registeredBefore = coreRef.current!.renderToolCalls.find(
      (r) => r.name === "showLabel",
    )!.render;

    rerender(
      <TestCopilotKit messages={[]}>
        <CaptureCore into={coreRef} />
        <LabelProbe label="after" deps={freshNonSerialisableDeps()} />
      </TestCopilotKit>,
    );
    // Let any pending effect + subscriber notification settle, so this asserts
    // "nothing happened" rather than "nothing has happened yet".
    await act(async () => {});

    expect(
      coreRef.current!.renderToolCalls.find((r) => r.name === "showLabel")!
        .render,
    ).toBe(registeredBefore);
    expect(container.textContent).toBe("before");
  });
});
