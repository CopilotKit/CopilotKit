import React from "react";
import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import type {
  A2UIComponentNode,
  A2UIOperation,
  GenerativeUIRejectedOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";

// React Native host components as DOM elements (see the mock module).
vi.mock("react-native", async () =>
  (await import("./generative-ui-rn-mock")).createReactNativeMock(),
);

// Imported after the mock is declared (vi.mock is hoisted anyway).
import {
  GenerativeUIActivity,
  GenerativeUISurface,
  isGenerativeUIActivity,
  nativeGenerativeUIHost,
  useGenerativeUIRuntime,
} from "../generative-ui";
import type {
  GenerativeUIActivityProps,
  GenerativeUIActivityWrapperProps,
  GenerativeUIProviderProps,
  GenerativeUISurfaceRootProps,
} from "../generative-ui";
import {
  Harness,
  S,
  activity,
  create,
  flaky,
  nodes,
  sparse,
  ui,
  warningsWith,
} from "./generative-ui-harness";

afterEach(() => vi.restoreAllMocks());

describe("GenerativeUIProvider", () => {
  it("gives the components below a generative UI runtime for the catalog", () => {
    let seen: unknown;
    function Probe() {
      seen = useGenerativeUIRuntime()?.ui;
      return null;
    }
    const agentRef = {
      current: null,
    } as React.MutableRefObject<AbstractAgent | null>;
    render(<Harness agentRef={agentRef}>{() => <Probe />}</Harness>);
    expect(seen).toBe(ui);
  });

  it("drops a theme from untyped callers before it reaches the runtime, and warns in development", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const themes: unknown[] = [];
    let runtimeTheme: unknown = "unset";
    function Probe() {
      runtimeTheme = useGenerativeUIRuntime()?.theme;
      return null;
    }
    function SurfaceRoot({ theme, children }: GenerativeUISurfaceRootProps) {
      themes.push(theme);
      return <>{children}</>;
    }
    const agentRef = {
      current: null,
    } as React.MutableRefObject<AbstractAgent | null>;
    // A JavaScript caller, or a cast, gets past the type.
    const untyped = {
      theme: { primary: "#ff0000" },
      host: { ...nativeGenerativeUIHost, SurfaceRoot },
    } as unknown as Partial<GenerativeUIProviderProps>;
    render(
      <Harness agentRef={agentRef} providerProps={untyped}>
        {(agent) => (
          <>
            <Probe />
            <GenerativeUIActivity
              message={activity(
                [
                  create,
                  nodes({
                    id: "root",
                    component: "Balance",
                    label: "T",
                    amount: 1,
                  }),
                ],
                "ready",
              )}
              agent={agent}
            />
          </>
        )}
      </Harness>,
    );
    expect(screen.getByTestId("balance-T")).toBeTruthy();
    expect(runtimeTheme).toBeUndefined();
    expect(themes.length).toBeGreaterThan(0);
    expect(themes.every((t) => t === undefined)).toBe(true);
    expect(
      warn.mock.calls.filter((c) => String(c[0]).includes("theme")),
    ).toHaveLength(1);
  });

  it("runs the tool transport even when an untyped caller asks for markdown, and warns in development", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let transport: unknown;
    function Probe() {
      transport = useGenerativeUIRuntime()?.transport;
      return null;
    }
    const agentRef = {
      current: null,
    } as React.MutableRefObject<AbstractAgent | null>;
    render(
      <Harness
        agentRef={agentRef}
        providerProps={
          {
            transport: "markdown",
          } as unknown as Partial<GenerativeUIProviderProps>
        }
      >
        {() => <Probe />}
      </Harness>,
    );
    expect(transport).toBe("tool");
    expect(
      warn.mock.calls.filter((c) => String(c[0]).includes('"markdown"')),
    ).toHaveLength(1);
  });

  it("warns in development when it has no ui", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const agentRef = {
      current: null,
    } as React.MutableRefObject<AbstractAgent | null>;
    const view = () => (
      <Harness
        agentRef={agentRef}
        providerProps={
          { ui: undefined } as unknown as Partial<GenerativeUIProviderProps>
        }
      >
        {() => null}
      </Harness>
    );
    const { rerender } = render(view());
    rerender(view());
    expect(
      warn.mock.calls.filter((c) =>
        String(c[0]).includes("<GenerativeUIProvider> has no `ui`"),
      ),
    ).toHaveLength(1);
  });

  it("uses a host given to it instead of the React Native host", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const agentRef = {
      current: null,
    } as React.MutableRefObject<AbstractAgent | null>;
    const host = {
      ...nativeGenerativeUIHost,
      NodeFallback: ({ componentId }: { componentId: string }) => (
        <div data-testid={`custom-fallback-${componentId}`} />
      ),
    };
    render(
      <Harness agentRef={agentRef} providerProps={{ host }}>
        {(agent) => (
          <GenerativeUIActivity
            message={activity(
              [create, nodes({ id: "root", component: "Boom" })],
              "ready",
            )}
            agent={agent}
          />
        )}
      </Harness>,
    );
    expect(screen.getByTestId("custom-fallback-root")).toBeTruthy();
    expect(screen.queryByTestId("generative-ui-error-root")).toBeNull();
  });
});

describe("GenerativeUIActivity", () => {
  function setup(
    initial: ReturnType<typeof activity>,
    props: Partial<React.ComponentProps<typeof GenerativeUIActivity>> = {},
  ) {
    const agentRef = {
      current: null,
    } as React.MutableRefObject<AbstractAgent | null>;
    const view = (message: ReturnType<typeof activity>) => (
      <Harness agentRef={agentRef}>
        {(agent) => (
          <GenerativeUIActivity message={message} agent={agent} {...props} />
        )}
      </Harness>
    );
    const utils = render(view(initial));
    return {
      rerender: (m: ReturnType<typeof activity>) => utils.rerender(view(m)),
    };
  }

  it("renders the catalog's React Native components from an activity message, and streams updates in", () => {
    const first = [
      create,
      nodes({ id: "root", component: "Column", children: ["a"] }),
      nodes({ id: "a", component: "Balance", label: "Chequing", amount: 3482 }),
    ];
    const { rerender } = setup(activity(first));
    expect(screen.getByTestId("column")).toBeTruthy();
    expect(screen.getByTestId("balance-Chequing").textContent).toBe(
      "Chequing: 3482",
    );

    // A later render_ui call adds a block to the same surface.
    rerender(
      activity(
        [
          ...first,
          nodes({ id: "root", component: "Column", children: ["a", "b"] }),
          nodes({
            id: "b",
            component: "Balance",
            label: "Savings",
            amount: 6150,
          }),
        ],
        "ready",
      ),
    );
    expect(screen.getByTestId("balance-Savings").textContent).toBe(
      "Savings: 6150",
    );
    expect(screen.getByTestId("balance-Chequing")).toBeTruthy();
  });

  const homeSurface = (target: string) =>
    activity(
      [
        create,
        nodes({ id: "root", component: "Balance", label: "Home", amount: 1 }),
      ],
      "ready",
      target,
    );

  it("renders only chat-target surfaces by default, like the web chat", () => {
    // A surface aimed at <GenerativeUISurface id="products"> is drawn there;
    // drawing it in the chat list too would show it twice.
    setup(homeSurface("products"));
    expect(screen.queryByTestId("balance-Home")).toBeNull();
  });

  it("renders a surface of another target when the target prop names it", () => {
    setup(homeSurface("products"), { target: "products" });
    expect(screen.getByTestId("balance-Home")).toBeTruthy();
  });

  it("with a target prop, does not render chat-target surfaces", () => {
    setup(homeSurface("chat"), { target: "products" });
    expect(screen.queryByTestId("balance-Home")).toBeNull();
  });

  it.each([
    ["no surfaceId", { surfaceId: undefined }, "surfaceId"],
    ["no operations", { operations: undefined }, "operations"],
    ["operations that are not an array", { operations: "nope" }, "operations"],
    ["an unknown status", { status: "done" }, "status"],
    ["no target", { target: undefined }, "target"],
    ["rejected that is not an array", { rejected: { index: 0 } }, "rejected"],
    [
      "a rejected entry with a NaN index",
      { rejected: [{ index: Number.NaN, reason: "bad" }] },
      "rejected[0]",
    ],
    [
      "a rejected entry that is not an object",
      { rejected: [{ index: 0, reason: "ok" }, "bad"] },
      "rejected[1]",
    ],
    // A hole reads as undefined, which the web content schema rejects too.
    [
      "a sparse rejected list",
      { rejected: sparse([1, { index: 1, reason: "x" }]) },
      "rejected[0]",
    ],
  ])(
    "renders nothing, does not throw, and warns with the issue in development, for malformed content (%s)",
    (_label, patch, field) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const Wrapper = vi.fn(() => null);
      const good = homeSurface("chat");
      const bad = { ...good, content: { ...good.content, ...patch } };
      expect(() =>
        setup(bad as unknown as ReturnType<typeof activity>, { Wrapper }),
      ).not.toThrow();
      expect(Wrapper).not.toHaveBeenCalled();
      expect(screen.queryByTestId("balance-Home")).toBeNull();
      const warnings = warningsWith(warn, "malformed");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(field);
    },
  );

  it("accepts a rejected entry with extra keys, like the web content schema", () => {
    const good = homeSurface("chat");
    const content = {
      ...good.content,
      rejected: [{ index: 1, reason: "bad", extra: true }],
    };
    setup({ ...good, content } as unknown as ReturnType<typeof activity>);
    expect(screen.getByTestId("balance-Home")).toBeTruthy();
  });

  it.each([
    ["null", null],
    ["a string", "text"],
    ["a number", 42],
    ["an array", []],
  ])(
    "renders nothing, and warns in development, for content that is %s",
    (_label, content) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const Wrapper = vi.fn(() => null);
      const good = homeSurface("chat");
      expect(() =>
        setup({ ...good, content } as unknown as ReturnType<typeof activity>, {
          Wrapper,
        }),
      ).not.toThrow();
      expect(Wrapper).not.toHaveBeenCalled();
      expect(screen.queryByTestId("balance-Home")).toBeNull();
      expect(warningsWith(warn, "malformed")).toHaveLength(1);
    },
  );

  it("treats missing rejected as an empty list", () => {
    const good = homeSurface("chat");
    const { rejected: _drop, ...content } = good.content;
    setup({ ...good, content } as unknown as ReturnType<typeof activity>);
    expect(screen.getByTestId("balance-Home")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  const bareActivity = (agent: GenerativeUIActivityProps["agent"]) => (
    <GenerativeUIActivity message={homeSurface("chat")} agent={agent} />
  );

  it("does not warn in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      render(bareActivity({ threadId: "t2" }));
      const good = homeSurface("chat");
      render(
        <GenerativeUIActivity
          message={{ ...good, content: null }}
          agent={{ threadId: "t2" }}
        />,
      );
      expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("warns once per component in development when there is no GenerativeUIProvider", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const agent = { threadId: "t1", agentId: "a1" };
    const { rerender, container } = render(bareActivity(agent));
    rerender(bareActivity(agent));
    expect(container.textContent).toBe("");
    expect(
      warningsWith(warn, "there is no <GenerativeUIProvider> above it"),
    ).toHaveLength(1);
    // Another component makes the same mistake: it warns as well, whatever
    // the tests that ran before.
    render(bareActivity(agent));
    expect(
      warningsWith(warn, "there is no <GenerativeUIProvider> above it"),
    ).toHaveLength(2);
  });

  it("says the provider has no ui, not that there is no provider, when the provider has no ui", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const agentRef = {
      current: null,
    } as React.MutableRefObject<AbstractAgent | null>;
    render(
      <Harness
        agentRef={agentRef}
        providerProps={
          { ui: undefined } as unknown as Partial<GenerativeUIProviderProps>
        }
      >
        {(agent) => bareActivity(agent)}
      </Harness>,
    );
    expect(warningsWith(warn, "there is no <GenerativeUIProvider>")).toEqual(
      [],
    );
    expect(
      warningsWith(
        warn,
        "<GenerativeUIActivity> renders nothing: the <GenerativeUIProvider> above it has no `ui`",
      ),
    ).toHaveLength(1);
  });

  it("warns in development when the agent is undefined, and again for a later, different mistake", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const agentRef = {
      current: null,
    } as React.MutableRefObject<AbstractAgent | null>;
    const view = (agent: GenerativeUIActivityProps["agent"]) => (
      <Harness agentRef={agentRef}>{() => bareActivity(agent)}</Harness>
    );
    const { rerender } = render(view(undefined));
    rerender(view(undefined));
    expect(warningsWith(warn, "the agent is undefined")).toHaveLength(1);
    rerender(view({ agentId: "a1" }));
    expect(warningsWith(warn, "has no threadId")).toHaveLength(1);
    expect(screen.queryByTestId("balance-Home")).toBeNull();
  });

  it("uses the React Native host: a failing component shows the native fallback, not a DOM alert", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setup(
      activity(
        [
          create,
          nodes({ id: "root", component: "Column", children: ["ok", "bad"] }),
          nodes({ id: "ok", component: "Balance", label: "Fine", amount: 1 }),
          nodes({ id: "bad", component: "Boom" }),
        ],
        "ready",
      ),
    );
    // The broken node is contained; its sibling still renders.
    expect(screen.getByTestId("balance-Fine")).toBeTruthy();
    const fallback = screen.getByTestId("generative-ui-error-bad");
    expect(fallback.textContent).toContain("kaboom");
    expect(fallback.getAttribute("role")).toBe("alert");
    // The DOM host would have rendered a div with data-generative-ui-error.
    expect(document.querySelector("[data-generative-ui-error]")).toBeNull();
  });

  it("Retry renders the component again, and the fallback goes away once it recovers", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    flaky.ok = false;
    setup(
      activity([create, nodes({ id: "root", component: "Flaky" })], "ready"),
    );
    expect(screen.getByTestId("generative-ui-error-root")).toBeTruthy();
    expect(screen.queryByTestId("flaky-ok")).toBeNull();
    flaky.ok = true;
    fireEvent.click(screen.getByText("Retry"));
    expect(screen.getByTestId("flaky-ok")).toBeTruthy();
    expect(screen.queryByTestId("generative-ui-error-root")).toBeNull();
  });

  it("shows the default alert when the runtime rejected an update", () => {
    const good = homeSurface("chat");
    setup({
      ...good,
      content: {
        ...good.content,
        rejected: [{ index: 2, reason: "unknown component" }],
      },
    });
    expect(screen.getByTestId("balance-Home")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe(
      "Part of this UI couldn't be shown.",
    );
  });

  it("the default wrapper grows to fill its parent, and keeps the error under the surface", () => {
    const good = homeSurface("chat");
    setup({
      ...good,
      content: {
        ...good.content,
        rejected: [{ index: 2, reason: "unknown component" }],
      },
    });
    const alert = screen.getByRole("alert");
    const wrapper = alert.parentElement!;
    // The wrapper is the view that holds both the surface and the alert.
    expect(wrapper.contains(screen.getByTestId("balance-Home"))).toBe(true);
    // A catalog root sized against its parent (flex: 1, a percentage
    // height) resolves against this view, so it must not be content-sized
    // where the parent has free space. flexGrow, not flex: 1, so a list row
    // (no free space) keeps its content height and is never shrunk.
    expect(JSON.parse(wrapper.getAttribute("data-style")!)).toEqual({
      flexGrow: 1,
    });
    expect(wrapper.lastElementChild).toBe(alert);
  });

  it("gives a custom Wrapper the rejected operations and an error whose cause is the same list", () => {
    const Wrapper = vi.fn(({ children }: GenerativeUIActivityWrapperProps) => (
      <>{children}</>
    ));
    const good = homeSurface("chat");
    const rejected = [{ index: 2, reason: "unknown component" }];
    setup({ ...good, content: { ...good.content, rejected } }, { Wrapper });
    const props = Wrapper.mock.calls.at(-1)![0];
    expect(props.rejected).toEqual(rejected);
    expect(props.error?.message).toBe("1 UI update(s) could not be shown");
    expect((props.error as Error & { cause?: unknown }).cause).toEqual(
      rejected,
    );
    // Not enumerable, as on the web: JSON.stringify, a spread and error
    // reporters leave the list out.
    expect(
      Object.prototype.propertyIsEnumerable.call(props.error, "cause"),
    ).toBe(false);
    expect({ ...props.error }).not.toHaveProperty("cause");
    expect(props.surfaceId).toBe(S);
    expect(props.isStreaming).toBe(false);
  });

  it("passes on the updates rejected on the device, also when only the in-place list grew", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const Wrapper = vi.fn(({ children }: GenerativeUIActivityWrapperProps) => (
      <>{children}</>
    ));
    // One `rejected` list for every content, so only the device's list,
    // which the manager appends to in place, changes.
    const serverRejected: GenerativeUIRejectedOperation[] = [];
    const message = (operations: A2UIOperation[]) => ({
      ...activity(operations, "streaming"),
      content: { ...activity(operations).content, rejected: serverRejected },
    });
    const ops = [
      create,
      nodes({ id: "root", component: "Balance", label: "Ok", amount: 1 }),
    ];
    const bad = (id: string) =>
      nodes({ id, component: "Balance", label: id, amount: "x" as never });
    const { rerender } = setup(message(ops), { Wrapper });
    expect(Wrapper.mock.calls.at(-1)![0].rejected).toEqual([]);
    rerender(message([...ops, bad("b1")]));
    expect(Wrapper.mock.calls.at(-1)![0].rejected).toHaveLength(1);
    rerender(message([...ops, bad("b1"), bad("b2")]));
    const last = Wrapper.mock.calls.at(-1)![0];
    expect(last.rejected.map((r) => r.index)).toEqual([2, 3]);
    expect(last.error?.message).toBe("2 UI update(s) could not be shown");
  });

  it("shows only the error, with no surface, when the agent's createSurface was rejected", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const Wrapper = vi.fn(({ children }: GenerativeUIActivityWrapperProps) => (
      <div data-testid="wrapper">{children}</div>
    ));
    const badCreate: A2UIOperation = {
      version: "1.0",
      createSurface: { surfaceId: S, catalogId: "no-such-catalog" },
    };
    setup(activity([badCreate], "ready"), { Wrapper });
    const props = Wrapper.mock.calls.at(-1)![0];
    expect(props.children).toBeNull();
    expect(props.rejected).toHaveLength(1);
    expect(props.rejected[0].reason).toContain("no-such-catalog");
    expect(screen.getByTestId("wrapper").textContent).toBe("");
  });

  it("renders nothing once the agent deleted the surface", () => {
    const Wrapper = vi.fn(() => null);
    setup(
      activity(
        [
          create,
          nodes({ id: "root", component: "Balance", label: "Gone", amount: 1 }),
          { version: "1.0", deleteSurface: { surfaceId: S } },
        ],
        "ready",
      ),
      { Wrapper },
    );
    expect(Wrapper).not.toHaveBeenCalled();
    expect(screen.queryByTestId("balance-Gone")).toBeNull();
  });

  it("draws no DOM surface root (no a2ui-surface element, no <style>)", () => {
    setup(
      activity(
        [
          create,
          nodes({ id: "root", component: "Balance", label: "X", amount: 2 }),
        ],
        "ready",
      ),
    );
    expect(document.querySelector(".a2ui-surface")).toBeNull();
    expect(document.querySelector("style")).toBeNull();
  });

  it("renders nothing for a message that is not a generative UI activity", () => {
    const agentRef = {
      current: null,
    } as React.MutableRefObject<AbstractAgent | null>;
    const { container } = render(
      <Harness agentRef={agentRef}>
        {(agent) => (
          <GenerativeUIActivity
            message={{ id: "m1", role: "assistant", content: "hi" }}
            agent={agent}
          />
        )}
      </Harness>,
    );
    expect(container.textContent).toBe("");
  });

  it("isGenerativeUIActivity picks out surface activity messages", () => {
    expect(isGenerativeUIActivity(activity([create]))).toBe(true);
    expect(isGenerativeUIActivity({ role: "assistant" })).toBe(false);
    expect(
      isGenerativeUIActivity({ role: "activity", activityType: "other" }),
    ).toBe(false);
  });
});

describe("GenerativeUISurface", () => {
  type Manager = NonNullable<
    ReturnType<typeof useGenerativeUIRuntime>
  >["manager"];
  /** Renders `children` in the harness and hands back the surface manager. */
  function mount(
    children: ReactNode,
    providerProps?: Partial<GenerativeUIProviderProps>,
  ) {
    const box: { manager?: Manager } = {};
    function Grab() {
      box.manager = useGenerativeUIRuntime()?.manager;
      return null;
    }
    const agentRef = {
      current: null,
    } as React.MutableRefObject<AbstractAgent | null>;
    const view = (c: ReactNode) => (
      <Harness agentRef={agentRef} providerProps={providerProps}>
        {() => (
          <>
            <Grab />
            {c}
          </>
        )}
      </Harness>
    );
    const utils = render(view(children));
    return {
      manager: () => box.manager!,
      rerender: (c: ReactNode) => utils.rerender(view(c)),
      unmount: utils.unmount,
    };
  }
  const insights = (
    status: GenerativeUISurfaceContent["status"],
    label = "Insight",
    surfaceId = S,
  ) => ({
    ...activity(
      [
        { version: "1.0", createSurface: { surfaceId, catalogId: "bank" } },
        {
          version: "1.0",
          updateComponents: {
            surfaceId,
            components: [
              { id: "root", component: "Balance", label, amount: 7 },
            ],
          },
        },
      ],
      status,
      "insights",
    ).content,
    surfaceId,
  });

  it("shows the fallback, then the surface the agent renders into its target", () => {
    const onStart = vi.fn();
    const { manager } = mount(
      <GenerativeUISurface
        id="insights"
        ui={ui}
        components={["Balance"]}
        description="Under the balances."
        fallback={<span>nothing yet</span>}
        onGenerationStart={onStart}
      />,
    );
    expect(screen.getByText("nothing yet")).toBeTruthy();
    act(() => {
      manager().setActiveThread("t1");
      manager().ingest("t1", "default", insights("streaming"));
    });
    expect(screen.getByTestId("balance-Insight")).toBeTruthy();
    expect(screen.getByTestId("generative-ui-surface-insights")).toBeTruthy();
    expect(screen.queryByText("nothing yet")).toBeNull();
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("applies style and testID while the fallback shows, too", () => {
    const style = { flex: 1 };
    const { manager } = mount(
      <GenerativeUISurface
        id="insights"
        style={style}
        fallback={<span>nothing yet</span>}
      />,
    );
    const box = screen.getByTestId("generative-ui-surface-insights");
    expect(box.textContent).toBe("nothing yet");
    expect(box.getAttribute("data-style")).toBe(JSON.stringify(style));
    act(() => {
      manager().setActiveThread("t1");
      manager().ingest("t1", "default", insights("ready"));
    });
    const after = screen.getByTestId("generative-ui-surface-insights");
    expect(after.getAttribute("data-style")).toBe(JSON.stringify(style));
    expect(after.textContent).toContain("Insight");
  });

  it("reports the same failure of a new surface in its target", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onError = vi.fn();
    const { manager } = mount(<GenerativeUISurface id="insights" />, {
      errorBoundary: { onError },
    });
    /** A surface in the target whose root always throws. */
    const broken = (surfaceId: string) => ({
      ...activity(
        [
          { version: "1.0", createSurface: { surfaceId, catalogId: "bank" } },
          {
            version: "1.0",
            updateComponents: {
              surfaceId,
              components: [{ id: "root", component: "Boom" }],
            },
          },
        ],
        "streaming",
        "insights",
      ).content,
      surfaceId,
    });
    act(() => {
      manager().setActiveThread("t1");
      manager().ingest("t1", "default", broken("first"));
    });
    act(() => manager().ingest("t1", "default", broken("second")));
    expect(
      onError.mock.calls.map(([info]) => [info.surfaceId, info.error.message]),
    ).toEqual([
      ["first", "kaboom"],
      ["second", "kaboom"],
    ]);
  });

  it("calls onGenerationStart for each render_ui call, also when React sees no ready render between two calls", () => {
    const onStart = vi.fn();
    const { manager } = mount(
      <GenerativeUISurface id="insights" onGenerationStart={onStart} />,
    );
    act(() => {
      manager().setActiveThread("t1");
      manager().ingest("t1", "default", insights("streaming"));
    });
    expect(onStart).toHaveBeenCalledTimes(1);
    // The first call ends and the second starts in the same React batch.
    act(() => {
      manager().ingest("t1", "default", insights("ready"));
      manager().ingest("t1", "default", insights("streaming", "Second"));
    });
    expect(onStart).toHaveBeenCalledTimes(2);
    // Updates within the same call do not count as a new start.
    act(() => {
      manager().ingest("t1", "default", insights("streaming", "Third"));
    });
    expect(onStart).toHaveBeenCalledTimes(2);
  });

  it("calls onGenerationStart when it mounts, or the thread changes, while the agent renders into it", () => {
    const onStart = vi.fn();
    const { manager, rerender } = mount(null);
    act(() => {
      manager().setActiveThread("t1");
      manager().ingest("t1", "default", insights("streaming"));
      manager().ingest("t2", "default", insights("streaming", "Other", "s2"));
    });
    rerender(<GenerativeUISurface id="insights" onGenerationStart={onStart} />);
    expect(onStart).toHaveBeenCalledTimes(1);
    act(() => manager().setActiveThread("t2"));
    expect(screen.getByTestId("balance-Other")).toBeTruthy();
    expect(onStart).toHaveBeenCalledTimes(2);
  });

  it("registers its target with its description and allowed components, and unregisters on unmount", () => {
    const { manager, rerender } = mount(
      <GenerativeUISurface
        id="insights"
        ui={ui}
        description="Under the balances."
        components={["Balance"]}
      />,
    );
    expect(manager().getMountedTargets()).toEqual([
      {
        id: "insights",
        description: "Under the balances.",
        components: ["Balance"],
      },
    ]);
    rerender(null);
    expect(manager().getMountedTargets()).toEqual([]);
  });

  it("leaves unknown component names out of the target, and warns once in development", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const names = ["Balance", "Nope"] as unknown as ["Balance"];
    const view = () => (
      <GenerativeUISurface id="insights" ui={ui} components={[...names]} />
    );
    const { manager, rerender } = mount(view());
    rerender(view());
    expect(manager().getMountedTargets()[0].components).toEqual(["Balance"]);
    expect(warningsWith(warn, "Nope")).toHaveLength(1);
  });

  it("does not register the target again for a new array with the same names", () => {
    const { manager, rerender } = mount(
      <GenerativeUISurface id="insights" ui={ui} components={["Balance"]} />,
    );
    const register = vi.spyOn(manager(), "registerTarget");
    rerender(
      <GenerativeUISurface id="insights" ui={ui} components={["Balance"]} />,
    );
    expect(register).not.toHaveBeenCalled();
    rerender(
      <GenerativeUISurface
        id="insights"
        ui={ui}
        components={["Balance", "Column"]}
      />,
    );
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("shows the fallback, and warns that the provider has no ui, under a provider without ui", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mount(
      <GenerativeUISurface id="insights" fallback={<span>nothing yet</span>} />,
      { ui: undefined } as unknown as Partial<GenerativeUIProviderProps>,
    );
    expect(screen.getByText("nothing yet")).toBeTruthy();
    expect(
      warningsWith(
        warn,
        '<GenerativeUISurface id="insights"> shows its fallback: the <GenerativeUIProvider> above it has no `ui`',
      ),
    ).toHaveLength(1);
  });

  it("throws, naming GenerativeUIProvider, when there is no provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<GenerativeUISurface id="insights" />)).toThrow(
      /<GenerativeUIProvider>/,
    );
  });
});

describe("the React Native accessibility wrapper", () => {
  function renderWithEnvelope(accessibility: Record<string, unknown>) {
    const agentRef = {
      current: null,
    } as React.MutableRefObject<AbstractAgent | null>;
    const message = activity(
      [
        create,
        nodes({
          id: "root",
          component: "Balance",
          label: "Totals",
          amount: 5,
          accessibility,
        } as A2UIComponentNode),
      ],
      "ready",
    );
    render(
      <Harness agentRef={agentRef}>
        {(agent) => <GenerativeUIActivity message={message} agent={agent} />}
      </Harness>,
    );
    // The wrapper is the native view around the component.
    return screen.getByTestId("balance-Totals").parentElement!;
  }

  it("is a real native view that is not flattened away, with no display: contents", () => {
    const wrapper = renderWithEnvelope({ live: "polite" });
    expect(wrapper.tagName).toBe("DIV");
    // display: contents needs RN 0.77+ on the New Architecture, and a
    // contents view is dropped from the native tree with its props.
    expect(wrapper.getAttribute("data-style")).not.toContain("contents");
    // Fabric and the Android view flattener drop a layout-only view, and
    // its accessibility props with it, unless it is not collapsable.
    expect(wrapper.getAttribute("data-collapsable")).toBe("false");
  });

  it("hides the component from VoiceOver and TalkBack when the envelope is hidden", () => {
    const wrapper = renderWithEnvelope({ hidden: true });
    expect(wrapper.getAttribute("data-accessibility-elements-hidden")).toBe(
      "true",
    );
    expect(wrapper.getAttribute("data-important-for-accessibility")).toBe(
      "no-hide-descendants",
    );
    expect(wrapper.getAttribute("data-aria-hidden")).toBe("true");
  });

  it("leaves the component visible to assistive technologies when it is not hidden", () => {
    const wrapper = renderWithEnvelope({ hidden: false, live: "polite" });
    expect(wrapper.hasAttribute("data-accessibility-elements-hidden")).toBe(
      false,
    );
    expect(wrapper.hasAttribute("data-important-for-accessibility")).toBe(
      false,
    );
    expect(wrapper.hasAttribute("data-aria-hidden")).toBe(false);
  });

  it.each([
    ["off", "none"],
    ["polite", "polite"],
    ["assertive", "assertive"],
  ])("maps aria-live %s to accessibilityLiveRegion %s", (live, region) => {
    const wrapper = renderWithEnvelope({ live });
    expect(wrapper.getAttribute("data-accessibility-live-region")).toBe(region);
  });

  it("has no layout style: it sizes to its child, so a child's flex or percentage height resolves inside it", () => {
    // Documented in host.tsx: the wrapper cannot read the style of the
    // component's root view, so it cannot pass flex sizing on. A component
    // that must fill its parent sets `accessibility: "self"`.
    const wrapper = renderWithEnvelope({ live: "polite" });
    expect(wrapper.getAttribute("data-style")).toBe("null");
  });

  it("is left out for a component that applies the envelope itself", () => {
    const agentRef = {
      current: null,
    } as React.MutableRefObject<AbstractAgent | null>;
    const message = activity(
      [
        create,
        nodes({
          id: "root",
          component: "Column",
          children: ["p"],
        }),
        nodes({
          id: "p",
          component: "SelfPanel",
          accessibility: { hidden: true },
        } as A2UIComponentNode),
      ],
      "ready",
    );
    render(
      <Harness agentRef={agentRef}>
        {(agent) => <GenerativeUIActivity message={message} agent={agent} />}
      </Harness>,
    );
    const panel = screen.getByTestId("self-panel");
    // Its parent is the Column, not a wrapper view.
    expect(panel.parentElement).toBe(screen.getByTestId("column"));
    expect(JSON.parse(panel.getAttribute("data-aria")!)).toMatchObject({
      "aria-hidden": true,
    });
  });
});
