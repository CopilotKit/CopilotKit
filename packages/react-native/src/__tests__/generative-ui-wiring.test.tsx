/**
 * The wiring of the React Native generative UI components on the paths a
 * happy-path mount leaves out: the provider's own ingest of
 * `agent.messages` (malformed content included), `<React.StrictMode>`, the
 * production build, and the warn-once contract.
 */
import React from "react";
import type { ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { COPILOTKIT_FORWARDED_PROPS_KEY } from "@copilotkit/shared";
import type {
  A2UIOperation,
  GenerativeUIRejectedOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import { useCopilotKit } from "@copilotkit/react-core/v2/context";
import { TestCopilotKit } from "../__mocks__/test-copilotkit";

vi.mock("react-native", async () =>
  (await import("./generative-ui-rn-mock")).createReactNativeMock(),
);

import {
  GenerativeUIActivity,
  GenerativeUIProvider,
  GenerativeUISurface,
  NativeNodeFallback,
  createGenerativeUI,
  useGenerativeUIRuntime,
} from "../generative-ui";
import type {
  GenerativeUIActivityProps,
  GenerativeUIActivityWrapperProps,
  GenerativeUIProviderProps,
} from "../generative-ui";
import {
  Balance,
  Harness,
  RunnableAgent,
  S,
  activity,
  create,
  inProduction,
  newAgentRef,
  nodes,
  startRun,
  ui,
  warningsWith,
} from "./generative-ui-harness";
import type { CopilotKitCore, HarnessProps } from "./generative-ui-harness";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

type Manager = NonNullable<
  ReturnType<typeof useGenerativeUIRuntime>
>["manager"];

/**
 * Mounts `children` in the harness. Hands back the agent, the core, the
 * surface manager, and rerender/unmount with the same harness options.
 */
function mount(
  children: (agent: AbstractAgent) => ReactNode,
  options: Omit<HarnessProps, "children" | "agentRef" | "coreRef"> = {},
) {
  const agentRef = newAgentRef();
  const coreRef = {
    current: null,
  } as React.MutableRefObject<CopilotKitCore | null>;
  const box: { manager?: Manager } = {};
  function Grab() {
    box.manager = useGenerativeUIRuntime()?.manager;
    return null;
  }
  const view = (
    c: (agent: AbstractAgent) => ReactNode,
    o: typeof options = options,
  ) => (
    <Harness {...o} agentRef={agentRef} coreRef={coreRef}>
      {(agent) => (
        <>
          <Grab />
          {c(agent)}
        </>
      )}
    </Harness>
  );
  const utils = render(view(children));
  return {
    agent: () => agentRef.current!,
    core: () => coreRef.current!,
    manager: () => box.manager!,
    run: () => startRun(coreRef.current!, agentRef.current!),
    rerender: (
      c: (agent: AbstractAgent) => ReactNode,
      o: typeof options = options,
    ) => utils.rerender(view(c, o)),
    unmount: utils.unmount,
  };
}

const ready = (label: string, target = "chat") =>
  activity(
    [create, nodes({ id: "root", component: "Balance", label, amount: 1 })],
    "ready",
    target,
  );

/** The content of a named-target surface. */
const insights = (
  status: GenerativeUISurfaceContent["status"],
  label = "Insight",
  surfaceId = S,
  rejected: GenerativeUIRejectedOperation[] = [],
): GenerativeUISurfaceContent => ({
  surfaceId,
  target: "insights",
  catalogId: "bank",
  status,
  rejected,
  operations: [
    { version: "1.0", createSurface: { surfaceId, catalogId: "bank" } },
    {
      version: "1.0",
      updateComponents: {
        surfaceId,
        components: [{ id: "root", component: "Balance", label, amount: 7 }],
      },
    },
  ],
});

describe("the provider's ingest of agent.messages", () => {
  it.each([false, true])(
    "ingests a valid activity message from agent.messages at the run start (strict: %s)",
    async (strict) => {
      const message = ready("Seeded");
      const h = mount(() => null, { messages: [message], strict });
      await h.run();
      expect(h.manager().getSurface(h.agent().threadId!, S)).toBeDefined();
    },
  );

  it.each([
    ["null", null],
    ["a string", "text"],
    ["no surfaceId", { ...ready("x").content, surfaceId: undefined }],
    ["an unknown status", { ...ready("x").content, status: "done" }],
    [
      "a NaN rejected index",
      { ...ready("x").content, rejected: [{ index: Number.NaN, reason: "r" }] },
    ],
  ])(
    "skips content that is %s without throwing, warns once in development, and still ingests the valid messages after it",
    async (_label, content) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const bad = { ...ready("x"), id: "bad", content };
      const good = {
        ...activity(
          [
            {
              version: "1.0",
              createSurface: { surfaceId: "s2", catalogId: "bank" },
            },
          ],
          "ready",
        ),
        id: "good",
        content: {
          ...activity([], "ready").content,
          surfaceId: "s2",
          operations: [
            {
              version: "1.0",
              createSurface: { surfaceId: "s2", catalogId: "bank" },
            } as A2UIOperation,
          ],
        },
      };
      const h = mount(() => null, { messages: [bad, good] });
      await h.run();
      // Core logs a throwing run-start subscriber with console.error.
      expect(error).not.toHaveBeenCalled();
      expect(h.manager().getSurface(h.agent().threadId!, "s2")).toBeDefined();
      expect(warningsWith(warn, "malformed")).toHaveLength(1);
      // A later change of the messages ingests them again: no new warning
      // for the same issue.
      act(() => {
        h.agent().setMessages([
          bad,
          good,
        ] as unknown as AbstractAgent["messages"]);
      });
      expect(error).not.toHaveBeenCalled();
      expect(warningsWith(warn, "malformed")).toHaveLength(1);
    },
  );

  it("a malformed message that arrives after the run start does not throw from the agent's subscription", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = mount(() => null);
    await h.run();
    expect(() =>
      act(() => {
        h.agent().setMessages([
          { ...ready("x"), content: null },
        ] as unknown as AbstractAgent["messages"]);
      }),
    ).not.toThrow();
    // The agent logs a throwing subscriber with console.error.
    expect(error).not.toHaveBeenCalled();
    expect(warningsWith(warn, "malformed")).toHaveLength(1);
  });

  it("<GenerativeUIActivity> renders nothing for a null content that is also in agent.messages", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const message = { ...ready("x"), content: null };
    const Wrapper = vi.fn(() => null);
    const h = mount(
      (agent) => (
        <GenerativeUIActivity
          message={message}
          agent={agent}
          Wrapper={Wrapper}
        />
      ),
      { messages: [message], strict: true },
    );
    await h.run();
    expect(error).not.toHaveBeenCalled();
    expect(Wrapper).not.toHaveBeenCalled();
  });
});

/** A named-target surface with `onStart` as its onGenerationStart. */
const surface = (onStart: () => void) => () => (
  <GenerativeUISurface id="insights" onGenerationStart={onStart} />
);

describe("onGenerationStart", () => {
  it("is called once for each render_ui start, also when React batches several starts", () => {
    const onStart = vi.fn();
    const h = mount(surface(onStart));
    act(() => {
      h.manager().setActiveThread("t1");
      h.manager().ingest("t1", "default", insights("streaming"));
      h.manager().ingest("t1", "default", insights("ready"));
      h.manager().ingest("t1", "default", insights("streaming", "Second"));
    });
    expect(onStart).toHaveBeenCalledTimes(2);
  });

  it("is called once, not twice, when it mounts under StrictMode while the agent renders", () => {
    const onStart = vi.fn();
    const h = mount(() => null, { strict: true });
    act(() => {
      h.manager().setActiveThread("t1");
      h.manager().ingest("t1", "default", insights("streaming"));
    });
    h.rerender(surface(onStart));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("is not called again when the runtime changes during the same render_ui call", () => {
    const onStart = vi.fn();
    const h = mount(surface(onStart));
    act(() => {
      h.manager().setActiveThread("t1");
      h.manager().ingest("t1", "default", insights("streaming"));
    });
    expect(onStart).toHaveBeenCalledTimes(1);
    // A new catalog object gives a new runtime and manager. The provider
    // builds the same surface again from the messages: not a new start.
    const ui2 = createGenerativeUI({
      id: "bank",
      components: { Balance: { component: Balance } },
    });
    h.rerender(surface(onStart), {
      providerProps: { ui: ui2 } as Partial<GenerativeUIProviderProps>,
    });
    act(() => {
      h.manager().setActiveThread("t1");
      h.manager().ingest("t1", "default", insights("streaming"));
    });
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("counts a new call when one update goes from streaming to streaming and the rejected list was reset", () => {
    const onStart = vi.fn();
    const h = mount(surface(onStart));
    act(() => {
      h.manager().setActiveThread("t1");
      h.manager().ingest(
        "t1",
        "default",
        insights("streaming", "First", S, [{ index: 5, reason: "bad" }]),
      );
    });
    expect(onStart).toHaveBeenCalledTimes(1);
    // The "ready" of the first call was never seen; the runtime resets
    // `rejected` to [] at the start of each call.
    act(() => {
      h.manager().ingest("t1", "default", insights("streaming", "Second"));
    });
    expect(onStart).toHaveBeenCalledTimes(2);
  });

  it("contains a throwing callback: the surface and its siblings stay, and the error is reported", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const onStart = vi.fn(() => {
      throw new Error("scroll failed");
    });
    const h = mount(() => (
      <>
        <span>sibling</span>
        <GenerativeUISurface id="insights" onGenerationStart={onStart} />
      </>
    ));
    act(() => {
      h.manager().setActiveThread("t1");
      h.manager().ingest("t1", "default", insights("streaming"));
    });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(screen.getByText("sibling")).toBeTruthy();
    expect(screen.getByTestId("balance-Insight")).toBeTruthy();
    expect(warningsWith(error, "onGenerationStart threw")).toHaveLength(1);
  });

  it("does not call a new callback identity on a re-render within the same call, and calls the latest one on the next start", () => {
    const first = vi.fn();
    const second = vi.fn();
    const h = mount(surface(first));
    act(() => {
      h.manager().setActiveThread("t1");
      h.manager().ingest("t1", "default", insights("streaming"));
    });
    h.rerender(surface(second));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    act(() => {
      h.manager().ingest("t1", "default", insights("ready"));
      h.manager().ingest("t1", "default", insights("streaming", "Next"));
    });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("warn once for each distinct cause", () => {
  const bare = (agent: GenerativeUIActivityProps["agent"], id = "m1") => (
    <GenerativeUIActivity message={{ ...ready("Home"), id }} agent={agent} />
  );

  it("<GenerativeUIActivity>: A, B, A warns A once and B once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = mount(() => bare(undefined));
    h.rerender(() => bare({ agentId: "a1" }));
    h.rerender(() => bare(undefined));
    expect(warningsWith(warn, "the agent is undefined")).toHaveLength(1);
    expect(warningsWith(warn, "has no threadId")).toHaveLength(1);
  });

  it("<GenerativeUIActivity>: warns again when the message changes to another message", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = mount(() => bare({ agentId: "a1" }, "m1"));
    h.rerender(() => bare({ agentId: "a1" }, "m2"));
    expect(warningsWith(warn, "has no threadId")).toHaveLength(2);
  });

  it("<GenerativeUISurface>: unknown components A, B, A warns once; a new ui warns again", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const view = (names: string[]) => () => (
      <GenerativeUISurface
        id="insights"
        ui={ui}
        components={names as unknown as ["Balance"]}
      />
    );
    const h = mount(view(["Balance", "Nope"]));
    h.rerender(view(["Balance"]));
    h.rerender(view(["Balance", "Nope"]));
    expect(warningsWith(warn, "Nope")).toHaveLength(1);
    const ui2 = createGenerativeUI({
      id: "bank",
      components: { Balance: { component: Balance } },
    });
    h.rerender(view(["Balance", "Nope"]), {
      providerProps: { ui: ui2 } as Partial<GenerativeUIProviderProps>,
    });
    expect(warningsWith(warn, "Nope")).toHaveLength(2);
  });
});

describe("two providers on one CopilotKit core", () => {
  function TwoProviders({ strict }: { strict?: boolean }) {
    const agentRef = newAgentRef();
    const tree = (
      <TestCopilotKit messages={[]} agentRef={agentRef}>
        <GenerativeUIProvider ui={ui}>
          <GenerativeUIProvider ui={ui}>{null}</GenerativeUIProvider>
        </GenerativeUIProvider>
      </TestCopilotKit>
    );
    return strict ? <React.StrictMode>{tree}</React.StrictMode> : tree;
  }

  it("warns in development", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<TwoProviders />);
    expect(
      warningsWith(warn, "more than one <GenerativeUIProvider>"),
    ).toHaveLength(1);
  });

  it("does not warn for one provider under StrictMode, or for providers on separate cores", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mount(() => null, { strict: true });
    mount(() => null);
    expect(warningsWith(warn, "more than one <GenerativeUIProvider>")).toEqual(
      [],
    );
  });
});

describe("<GenerativeUISurface> rejected operations", () => {
  it("shows the default alert for a named-target surface with rejected operations", () => {
    const h = mount(() => <GenerativeUISurface id="insights" />);
    act(() => {
      h.manager().setActiveThread("t1");
      h.manager().ingest(
        "t1",
        "default",
        insights("ready", "Insight", S, [{ index: 3, reason: "unknown" }]),
      );
    });
    expect(screen.getByTestId("balance-Insight")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe(
      "Part of this UI couldn't be shown.",
    );
  });

  it("gives a custom Wrapper the server and device rejections together", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const Wrapper = vi.fn(({ children }: GenerativeUIActivityWrapperProps) => (
      <>{children}</>
    ));
    const h = mount(() => (
      <GenerativeUISurface id="insights" Wrapper={Wrapper} />
    ));
    const content = insights("streaming", "Insight", S, [
      { index: 9, reason: "server" },
    ]);
    act(() => {
      h.manager().setActiveThread("t1");
      h.manager().ingest("t1", "default", {
        ...content,
        operations: [
          ...content.operations,
          nodes({
            id: "bad",
            component: "Balance",
            label: "b",
            amount: "x" as never,
          }),
        ],
      });
    });
    const props = Wrapper.mock.calls.at(-1)![0];
    expect(props.rejected.map((r) => r.index)).toEqual([9, 2]);
    expect(props.error?.message).toBe("2 UI update(s) could not be shown");
    // The list is the error's cause, not enumerable, as on the web.
    expect((props.error as Error & { cause?: unknown }).cause).toEqual(
      props.rejected,
    );
    expect(
      Object.prototype.propertyIsEnumerable.call(props.error, "cause"),
    ).toBe(false);
    expect(props.isStreaming).toBe(true);
    expect(props.surfaceId).toBe(S);
  });
});

describe("the transport warning", () => {
  it("names a non-string transport readably, not as [object Object]", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mount(() => null, {
      providerProps: {
        transport: { kind: "markdown" },
      } as unknown as Partial<GenerativeUIProviderProps>,
    });
    const warnings = warningsWith(warn, "ignores transport");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain("[object Object]");
    expect(warnings[0]).toContain('{"kind":"markdown"}');
  });

  it("stays silent for an explicit tool transport", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mount(() => null, {
      providerProps: {
        transport: "tool",
      } as Partial<GenerativeUIProviderProps>,
    });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("production", () => {
  it("prints no warning for any of the development warnings", async () => {
    await inProduction(async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const noUI = {
        ui: undefined,
      } as unknown as Partial<GenerativeUIProviderProps>;
      const untyped = {
        theme: { primary: "#f00" },
        transport: "markdown",
      } as unknown as Partial<GenerativeUIProviderProps>;
      const malformed = { ...ready("x"), content: null };
      // Provider: theme, transport, malformed agent.messages.
      const h = mount(
        (agent) => (
          <>
            {/* Activity: malformed, undefined agent, no threadId. */}
            <GenerativeUIActivity message={malformed} agent={agent} />
            <GenerativeUIActivity message={ready("a")} agent={undefined} />
            <GenerativeUIActivity
              message={ready("b")}
              agent={{ agentId: "x" }}
            />
            {/* Surface: other ui, unknown components. */}
            <GenerativeUISurface
              id="insights"
              ui={createGenerativeUI({
                id: "other",
                components: { Balance: { component: Balance } },
              })}
              components={["Nope"] as unknown as ["Balance"]}
            />
          </>
        ),
        { providerProps: untyped, messages: [malformed], strict: true },
      );
      await h.run();
      // Provider without ui, Surface under it, Activity under it.
      mount(
        (agent) => (
          <>
            <GenerativeUISurface id="insights" />
            <GenerativeUIActivity message={ready("c")} agent={agent} />
          </>
        ),
        { providerProps: noUI },
      );
      // Activity with no provider.
      render(
        <GenerativeUIActivity message={ready("d")} agent={{ threadId: "t" }} />,
      );
      // Two providers on one core.
      render(
        <TestCopilotKit messages={[]}>
          <GenerativeUIProvider ui={ui}>
            <GenerativeUIProvider ui={ui}>{null}</GenerativeUIProvider>
          </GenerativeUIProvider>
        </TestCopilotKit>,
      );
      expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([]);
    });
  });
});

describe("<GenerativeUISurface> targets", () => {
  it("warns in development when its ui is not the provider's", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const other = createGenerativeUI({
      id: "other",
      components: { Balance: { component: Balance } },
    });
    mount(() => <GenerativeUISurface id="insights" ui={other} />);
    expect(
      warningsWith(warn, "the ui prop is not the UI of the provider"),
    ).toHaveLength(1);
  });

  it("registers the new target when id changes, and again when description changes", () => {
    const h = mount(() => (
      <GenerativeUISurface id="insights" description="One" />
    ));
    expect(h.manager().getMountedTargets()).toEqual([
      { id: "insights", description: "One", components: undefined },
    ]);
    h.rerender(() => <GenerativeUISurface id="offers" description="One" />);
    expect(h.manager().getMountedTargets()).toEqual([
      { id: "offers", description: "One", components: undefined },
    ]);
    h.rerender(() => <GenerativeUISurface id="offers" description="Two" />);
    expect(h.manager().getMountedTargets()).toEqual([
      { id: "offers", description: "Two", components: undefined },
    ]);
  });

  it.each([
    ["an empty list", []],
    ["only unknown names", ["Nope"]],
  ])(
    "with %s, registers a target that allows no component",
    (_label, names) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const h = mount(() => (
        <GenerativeUISurface
          id="insights"
          ui={ui}
          components={names as unknown as ["Balance"]}
        />
      ));
      expect(h.manager().getMountedTargets()[0].components).toEqual([]);
    },
  );
});

describe("<GenerativeUIActivity> wiring", () => {
  it("passes isStreaming true while the agent writes the surface", () => {
    const Wrapper = vi.fn(({ children }: GenerativeUIActivityWrapperProps) => (
      <>{children}</>
    ));
    const message = activity(
      [
        create,
        nodes({ id: "root", component: "Balance", label: "S", amount: 1 }),
      ],
      "streaming",
    );
    mount((agent) => (
      <GenerativeUIActivity message={message} agent={agent} Wrapper={Wrapper} />
    ));
    expect(Wrapper.mock.calls.at(-1)![0].isStreaming).toBe(true);
  });

  it("renders the surface once the agent's threadId arrives after mount", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const view = (agent: GenerativeUIActivityProps["agent"]) => () => (
      <GenerativeUIActivity message={ready("Late")} agent={agent} />
    );
    const h = mount(view({ agentId: "default" }));
    expect(screen.queryByTestId("balance-Late")).toBeNull();
    h.rerender(view({ agentId: "default", threadId: "t-late" }));
    expect(screen.getByTestId("balance-Late")).toBeTruthy();
  });

  it("two activities for one surface both render it, from one manager surface", () => {
    const message = ready("Twice");
    const h = mount((agent) => (
      <>
        <GenerativeUIActivity message={message} agent={agent} />
        <GenerativeUIActivity message={message} agent={agent} />
      </>
    ));
    expect(screen.getAllByTestId("balance-Twice")).toHaveLength(2);
    expect(h.manager().getSurface(h.agent().threadId!, S)).toBeDefined();
  });

  it.each([false, true])(
    "renders under StrictMode (strict: %s) and from the provider path",
    async (strict) => {
      const message = ready("Strict");
      const h = mount(
        (agent) => <GenerativeUIActivity message={message} agent={agent} />,
        { messages: [message], strict },
      );
      await h.run();
      expect(screen.getAllByTestId("balance-Strict")).toHaveLength(1);
    },
  );
});

describe("agentIds", () => {
  it("sends the catalog only to the agents it names", async () => {
    const agent = new RunnableAgent();
    const other = new RunnableAgent();
    const coreRef = {
      current: null,
    } as React.MutableRefObject<CopilotKitCore | null>;
    function Probe() {
      coreRef.current = useCopilotKit().copilotkit;
      return null;
    }
    render(
      <TestCopilotKit messages={[]} agent={agent} agents={{ other }}>
        <Probe />
        <GenerativeUIProvider ui={ui} agentIds={["other"]}>
          {null}
        </GenerativeUIProvider>
      </TestCopilotKit>,
    );
    await startRun(coreRef.current!, agent);
    await startRun(coreRef.current!, other);
    const uiOf = (a: RunnableAgent) =>
      (a.inputs[0]?.forwardedProps as Record<string, { ui?: unknown }>)?.[
        COPILOTKIT_FORWARDED_PROPS_KEY
      ]?.ui;
    expect(uiOf(agent)).toBeUndefined();
    expect(uiOf(other)).toBeDefined();
  });
});

describe("NativeNodeFallback", () => {
  it("draws no Retry button when there is no retry", () => {
    render(<NativeNodeFallback message="kaboom" componentId="root" />);
    expect(screen.getByTestId("generative-ui-error-root")).toBeTruthy();
    expect(screen.queryByText("Retry")).toBeNull();
  });
});
