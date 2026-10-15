import React, { useEffect, useState } from "react";
import { act, screen, waitFor } from "@testing-library/react";
import { z } from "zod";
import { useFrontendTool } from "../use-frontend-tool";
import { useHumanInTheLoop } from "../use-human-in-the-loop";
import { useRenderTool } from "../use-render-tool";
import { useCopilotKit } from "../../providers/CopilotKitProvider";
import type { CopilotKitCoreReact } from "../../lib/react-core";
import { renderWithCopilotKit } from "../../__tests__/utils/test-helpers";

/**
 * The agent object from `useAgent` becomes circular once the realtime socket
 * attaches, and callers pass it in a tool hook's `deps`. The hooks must compare
 * deps by identity, like React does, rather than serializing them: a
 * serialized circular value throws "Converting circular structure to JSON"
 * during render and takes the page down.
 */

type CircularAgent = { id: string; self?: CircularAgent };

function makeCircularAgent(id: string): CircularAgent {
  const agent: CircularAgent = { id };
  agent.self = agent;
  return agent;
}

const CoreCapture: React.FC<{
  onCore: (core: CopilotKitCoreReact) => void;
}> = ({ onCore }) => {
  const { copilotkit } = useCopilotKit();
  useEffect(() => {
    onCore(copilotkit);
  }, [copilotkit, onCore]);
  return null;
};

type HookUnderTest = (deps: ReadonlyArray<unknown>) => void;

const hooks: Array<{
  name: string;
  use: HookUnderTest;
  spyOn: "addTool" | "addHookRenderToolCall";
}> = [
  {
    name: "useHumanInTheLoop",
    spyOn: "addTool",
    use: (deps) =>
      useHumanInTheLoop(
        {
          name: "circular_hitl",
          description: "Confirm",
          parameters: z.object({}),
          render: () => <div />,
        },
        deps,
      ),
  },
  {
    name: "useFrontendTool",
    spyOn: "addTool",
    use: (deps) =>
      useFrontendTool(
        {
          name: "circular_frontend",
          description: "Do it",
          parameters: z.object({}),
          handler: async () => "ok",
        },
        deps,
      ),
  },
  {
    name: "useRenderTool",
    spyOn: "addHookRenderToolCall",
    use: (deps) =>
      useRenderTool(
        {
          name: "circular_render",
          parameters: z.object({}),
          render: () => <div />,
        },
        deps,
      ),
  },
];

describe.each(hooks)("$name with a circular dependency", ({ use, spyOn }) => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not throw, and re-registers only when the dependency identity changes", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let coreRef: CopilotKitCoreReact | null = null;
    let spy: ReturnType<typeof vi.spyOn> | null = null;
    const first = makeCircularAgent("first");
    const second = makeCircularAgent("second");

    const Harness: React.FC = () => {
      const [agent, setAgent] = useState(first);
      const [, setTick] = useState(0);
      use([agent]);
      return (
        <>
          <button data-testid="rerender" onClick={() => setTick((n) => n + 1)}>
            rerender
          </button>
          <button data-testid="swap" onClick={() => setAgent(second)}>
            swap
          </button>
        </>
      );
    };

    const ui = renderWithCopilotKit({
      children: (
        <>
          <CoreCapture
            onCore={(c) => {
              if (!spy) spy = vi.spyOn(c, spyOn);
              coreRef = c;
            }}
          />
          <Harness />
        </>
      ),
    });

    await waitFor(() => expect(coreRef).not.toBeNull());
    const baseline = spy!.mock.calls.length;

    // Same agent identity: a re-render must not re-register the tool.
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        screen.getByTestId("rerender").click();
      });
    }
    expect(spy!.mock.calls.length).toBe(baseline);

    // New agent identity: the tool re-registers exactly once.
    await act(async () => {
      screen.getByTestId("swap").click();
    });
    expect(spy!.mock.calls.length).toBe(baseline + 1);

    ui.unmount();
  });
});
