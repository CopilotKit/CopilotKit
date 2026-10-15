import React, { useCallback, useState } from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { z } from "zod";
import type { ToolCall } from "@ag-ui/core";
import { useFrontendTool } from "../use-frontend-tool";
import { useHumanInTheLoop } from "../use-human-in-the-loop";
import { useRenderTool } from "../use-render-tool";
import { useRenderToolCall } from "../use-render-tool-call";
import { useCopilotKit } from "../../providers/CopilotKitProvider";
import type { CopilotKitCoreReact } from "../../lib/react-core";
import { renderWithCopilotKit } from "../../__tests__/utils/test-helpers";

/**
 * PE-848. The tool hooks used to put `JSON.stringify(deps)` in their effect
 * dependency list. That threw on a circular value, such as the agent from
 * `useAgent` once its realtime socket attaches, and it turned a function into
 * `null`, so a changed callback never re-registered.
 *
 * The contract these tests pin:
 * - plain data (primitives, plain objects, arrays, dates) compares by value, so
 *   an inline literal such as `[{ status }]` does not re-register every render;
 * - functions always compare equal, as they did under `JSON.stringify`;
 * - everything else (class instances, circular values) compares by identity,
 *   and never throws;
 * - a change in the length of `deps` always counts as a change.
 */

let core: CopilotKitCoreReact | null = null;
const Capture: React.FC = () => {
  core = useCopilotKit().copilotkit as CopilotKitCoreReact;
  return null;
};

type CircularAgent = { id: string; self?: CircularAgent };
function makeCircularAgent(id: string): CircularAgent {
  const agent: CircularAgent = { id };
  agent.self = agent;
  return agent;
}

type HookCase = {
  name: string;
  /** The core method whose call count is the number of registrations. */
  spyOn: "addTool" | "addHookRenderToolCall";
  use: (deps: ReadonlyArray<unknown>) => void;
};

const hookCases: HookCase[] = [
  {
    name: "useHumanInTheLoop",
    spyOn: "addTool",
    use: (deps) =>
      useHumanInTheLoop(
        {
          name: "deps_hitl",
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
          name: "deps_frontend",
          description: "Do it",
          parameters: z.object({}),
          handler: async () => "ok",
          render: () => <div />,
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
          name: "deps_render",
          parameters: z.object({}),
          render: () => <div />,
        },
        deps,
      ),
  },
];

/**
 * Mounts `use` with deps produced from a piece of state, and returns a setter
 * plus a counter of registrations made after mount.
 */
async function mountWithDeps<S>(
  hookCase: HookCase,
  initial: S,
  toDeps: (state: S) => ReadonlyArray<unknown>,
) {
  let setState: (next: S) => void = () => {};
  let setTick: React.Dispatch<React.SetStateAction<number>> = () => {};
  const Harness: React.FC = () => {
    const [state, set] = useState(initial);
    const [, tick] = useState(0);
    setState = set;
    setTick = tick;
    hookCase.use(toDeps(state));
    return null;
  };

  const ui = renderWithCopilotKit({
    children: (
      <>
        <Capture />
        <Harness />
      </>
    ),
  });
  await waitFor(() => expect(core).not.toBeNull());
  const spy = vi.spyOn(core!, hookCase.spyOn);

  return {
    ui,
    registrations: () => spy.mock.calls.length,
    set: async (next: S) => {
      await act(async () => setState(next));
    },
    rerender: async (times = 1) => {
      for (let i = 0; i < times; i++) {
        await act(async () => setTick((n) => n + 1));
      }
    },
  };
}

describe.each(hookCases)("$name deps comparison", (hookCase) => {
  beforeEach(() => {
    core = null;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not re-register when inline literal deps keep the same value", async () => {
    const h = await mountWithDeps(hookCase, 0, (n) => [
      { status: "idle", n },
      ["a", "b"].filter(Boolean),
      new Date(0),
    ]);

    await h.rerender(5);
    expect(h.registrations()).toBe(0);

    // A changed value inside the literal is a real change.
    await h.set(1);
    expect(h.registrations()).toBe(1);
    h.ui.unmount();
  });

  it("does not throw on a circular dep, and re-registers only when its identity changes", async () => {
    const first = makeCircularAgent("first");
    const second = makeCircularAgent("second");
    const h = await mountWithDeps(hookCase, first, (agent) => [agent]);

    await h.rerender(3);
    expect(h.registrations()).toBe(0);

    await h.set(second);
    expect(h.registrations()).toBe(1);
    h.ui.unmount();
  });

  it("does not throw on a plain object that contains a cycle", async () => {
    const h = await mountWithDeps(hookCase, 0, (n) => {
      const node: Record<string, unknown> = { n };
      node.parent = node;
      return [node];
    });

    await h.rerender(3);
    expect(h.registrations()).toBe(0);

    await h.set(1);
    expect(h.registrations()).toBe(1);
    h.ui.unmount();
  });

  it("does not re-register when a function dep changes identity (same as before)", async () => {
    let setCount: React.Dispatch<React.SetStateAction<number>> = () => {};
    let setTick: React.Dispatch<React.SetStateAction<number>> = () => {};
    const Harness: React.FC = () => {
      const [count, set] = useState(0);
      const [, tick] = useState(0);
      setCount = set;
      setTick = tick;
      const callback = useCallback(() => count, [count]);
      hookCase.use([callback]);
      return null;
    };
    renderWithCopilotKit({
      children: (
        <>
          <Capture />
          <Harness />
        </>
      ),
    });
    await waitFor(() => expect(core).not.toBeNull());
    const spy = vi.spyOn(core!, hookCase.spyOn);

    await act(async () => setTick((n) => n + 1));
    expect(spy).toHaveBeenCalledTimes(0);

    await act(async () => setCount(1));
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it("re-registers each time deps change length, without a React warning", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(String(args[0]));
    });
    const h = await mountWithDeps<unknown[]>(hookCase, [], (deps) => deps);

    await h.set(["x"]);
    expect(h.registrations()).toBe(1);
    await h.set(["x", "y"]);
    expect(h.registrations()).toBe(2);
    await h.set(["z"]);
    expect(h.registrations()).toBe(3);

    expect(errors.filter((e) => /changed size/.test(e))).toEqual([]);
    h.ui.unmount();
  });
});

describe("tool hooks in a component that also reads useRenderToolCall", () => {
  // Registering a renderer notifies `useRenderToolCall` subscribers, which
  // re-render. If the hook then saw its deps as changed it would register again,
  // forever. The cap only exists so a regression fails instead of exhausting
  // the worker's memory.
  const CAP = 50;

  it.each([
    ["an inline object literal", () => [{}]],
    ["an inline function", () => [() => null]],
  ])(
    "useRenderTool with %s in deps stops rendering",
    async (_label, makeDeps) => {
      let renders = 0;
      const Harness: React.FC = () => {
        renders++;
        useRenderToolCall();
        useRenderTool(
          { name: "loop", parameters: z.object({}), render: () => <div /> },
          renders > CAP ? [] : makeDeps(),
        );
        return null;
      };
      renderWithCopilotKit({ children: <Harness /> });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
      });
      expect(renders).toBeLessThan(10);
    },
  );

  it("useFrontendTool with an inline function in deps stops rendering", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let renders = 0;
    const Harness: React.FC = () => {
      renders++;
      useRenderToolCall();
      useFrontendTool(
        {
          name: "loop_frontend",
          description: "d",
          parameters: z.object({}),
          render: () => <div />,
        },
        renders > CAP ? [] : [() => null],
      );
      return null;
    };
    renderWithCopilotKit({ children: <Harness /> });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(renders).toBeLessThan(10);
    vi.restoreAllMocks();
  });
});

describe("useHumanInTheLoop card identity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const toolCall: ToolCall = {
    id: "tc-approve",
    type: "function",
    function: { name: "approve", arguments: "{}" },
  };

  const Stage: React.FC = () => {
    const renderToolCall = useRenderToolCall();
    return <>{renderToolCall({ toolCall })}</>;
  };

  it("does not remount the card across parent re-renders when deps are inline plain data", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let setTick: React.Dispatch<React.SetStateAction<number>> = () => {};

    const Harness: React.FC = () => {
      const [, tick] = useState(0);
      setTick = tick;
      useHumanInTheLoop(
        {
          name: "approve",
          description: "Approve",
          parameters: z.object({}),
          // An inline render with its own state: a new function every render.
          render: () => {
            const [value, setValue] = useState("");
            return (
              <input
                data-testid="card-input"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            );
          },
        },
        // A new literal every render, with the same contents.
        [{ status: "idle" }],
      );
      return null;
    };

    renderWithCopilotKit({
      children: (
        <>
          <Capture />
          <Harness />
          <Stage />
        </>
      ),
    });
    await waitFor(() => expect(screen.getByTestId("card-input")).toBeDefined());

    const registeredRender = () =>
      core!.renderToolCalls.find((r) => r.name === "approve")?.render;
    const initialRender = registeredRender();

    fireEvent.change(screen.getByTestId("card-input"), {
      target: { value: "typed" },
    });

    for (let i = 0; i < 5; i++) {
      await act(async () => setTick((n) => n + 1));
    }

    // Nothing re-registered, so the chat still mounts the same component and
    // the card keeps what the user typed.
    expect(registeredRender()).toBe(initialRender);
    expect((screen.getByTestId("card-input") as HTMLInputElement).value).toBe(
      "typed",
    );
  });
});
