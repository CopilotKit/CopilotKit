import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import CopilotChatConfigurationProvider from "../CopilotChatConfigurationProvider.vue";
import { useCopilotChatConfiguration } from "../useCopilotChatConfiguration";
import { CopilotChatDefaultLabels } from "../types";

function makeDisplay() {
  return defineComponent({
    setup() {
      const config = useCopilotChatConfiguration();
      return () =>
        h("div", [
          h(
            "span",
            { "data-testid": "agent" },
            config.value?.agentId ?? "no-config",
          ),
          h(
            "span",
            { "data-testid": "thread" },
            config.value?.threadId ?? "no-config",
          ),
          h(
            "span",
            { "data-testid": "placeholder" },
            config.value?.labels.chatInputPlaceholder ?? "no-config",
          ),
          h(
            "span",
            { "data-testid": "copy" },
            config.value?.labels.assistantMessageToolbarCopyMessageLabel ??
              "no-config",
          ),
          h(
            "span",
            { "data-testid": "modal" },
            String(config.value?.isModalOpen),
          ),
          h(
            "span",
            { "data-testid": "explicit" },
            String(config.value?.hasExplicitThreadId ?? "no-config"),
          ),
        ]);
    },
  });
}

describe("CopilotChatConfigurationProvider", () => {
  it("provides default values", () => {
    const Display = makeDisplay();
    const wrapper = mount(CopilotChatConfigurationProvider, {
      props: { threadId: "thread-1" },
      slots: { default: () => h(Display) },
    });

    expect(wrapper.find("[data-testid=agent]").text()).toBe(DEFAULT_AGENT_ID);
    expect(wrapper.find("[data-testid=thread]").text()).toBe("thread-1");
    expect(wrapper.find("[data-testid=placeholder]").text()).toBe(
      CopilotChatDefaultLabels.chatInputPlaceholder,
    );
  });

  it("accepts custom agentId and merges labels", () => {
    const Display = makeDisplay();
    const wrapper = mount(CopilotChatConfigurationProvider, {
      props: {
        threadId: "thread-1",
        agentId: "agent-custom",
        labels: { chatInputPlaceholder: "Custom Placeholder" },
      },
      slots: { default: () => h(Display) },
    });

    expect(wrapper.find("[data-testid=agent]").text()).toBe("agent-custom");
    expect(wrapper.find("[data-testid=placeholder]").text()).toBe(
      "Custom Placeholder",
    );
    expect(wrapper.find("[data-testid=copy]").text()).toBe(
      CopilotChatDefaultLabels.assistantMessageToolbarCopyMessageLabel,
    );
  });

  it("returns null from hook without provider", () => {
    const Display = makeDisplay();
    const wrapper = mount(Display);

    expect(wrapper.find("[data-testid=agent]").text()).toBe("no-config");
    expect(wrapper.find("[data-testid=thread]").text()).toBe("no-config");
    expect(wrapper.find("[data-testid=placeholder]").text()).toBe("no-config");
  });

  it("uses nested provider precedence", () => {
    const Display = makeDisplay();
    const wrapper = mount(CopilotChatConfigurationProvider, {
      props: {
        threadId: "outer-thread",
        agentId: "outer-agent",
        labels: { chatInputPlaceholder: "Outer" },
      },
      slots: {
        default: () =>
          h(
            CopilotChatConfigurationProvider,
            {
              threadId: "inner-thread",
              agentId: "inner-agent",
              labels: { chatInputPlaceholder: "Inner" },
            },
            { default: () => h(Display) },
          ),
      },
    });

    expect(wrapper.find("[data-testid=agent]").text()).toBe("inner-agent");
    expect(wrapper.find("[data-testid=thread]").text()).toBe("inner-thread");
    expect(wrapper.find("[data-testid=placeholder]").text()).toBe("Inner");
  });

  it("creates and mutates modal state when isModalDefaultOpen is provided", async () => {
    const Toggle = defineComponent({
      setup() {
        const config = useCopilotChatConfiguration();
        const close = () => config.value?.setModalOpen?.(false);
        return () =>
          h("div", [
            h(
              "span",
              { "data-testid": "modal" },
              String(config.value?.isModalOpen),
            ),
            h("button", { "data-testid": "close", onClick: close }, "close"),
          ]);
      },
    });

    const wrapper = mount(CopilotChatConfigurationProvider, {
      props: {
        threadId: "thread-1",
        isModalDefaultOpen: true,
      },
      slots: { default: () => h(Toggle) },
    });

    expect(wrapper.find("[data-testid=modal]").text()).toBe("true");
    await wrapper.find("[data-testid=close]").trigger("click");
    await nextTick();
    expect(wrapper.find("[data-testid=modal]").text()).toBe("false");
  });

  it("creates modal state when isModalDefaultOpen is passed through template bindings", () => {
    const Display = makeDisplay();
    const TemplateWrapper = defineComponent({
      components: { CopilotChatConfigurationProvider, Display },
      template: `
        <CopilotChatConfigurationProvider
          thread-id="thread-1"
          :is-modal-default-open="true"
        >
          <Display />
        </CopilotChatConfigurationProvider>
      `,
    });

    const wrapper = mount(TemplateWrapper);

    expect(wrapper.find("[data-testid=modal]").text()).toBe("true");
  });

  describe("hasExplicitThreadId", () => {
    it("infers true when threadId is supplied and hasExplicitThreadId is omitted", () => {
      const Display = makeDisplay();
      const wrapper = mount(CopilotChatConfigurationProvider, {
        props: { threadId: "thread-1" },
        slots: { default: () => h(Display) },
      });

      expect(wrapper.find("[data-testid=explicit]").text()).toBe("true");
    });

    it("infers false when neither threadId nor hasExplicitThreadId is supplied", () => {
      const Display = makeDisplay();
      const wrapper = mount(CopilotChatConfigurationProvider, {
        props: {},
        slots: { default: () => h(Display) },
      });

      expect(wrapper.find("[data-testid=explicit]").text()).toBe("false");
    });

    it("respects hasExplicitThreadId=false even when threadId is present", () => {
      const Display = makeDisplay();
      const wrapper = mount(CopilotChatConfigurationProvider, {
        props: { threadId: "thread-1", hasExplicitThreadId: false },
        slots: { default: () => h(Display) },
      });

      expect(wrapper.find("[data-testid=explicit]").text()).toBe("false");
    });

    it("explicit parent overrides non-explicit child", () => {
      const Display = makeDisplay();
      const wrapper = mount(CopilotChatConfigurationProvider, {
        props: { threadId: "outer-thread" },
        slots: {
          default: () =>
            h(
              CopilotChatConfigurationProvider,
              { threadId: "inner-thread", hasExplicitThreadId: false },
              { default: () => h(Display) },
            ),
        },
      });

      expect(wrapper.find("[data-testid=explicit]").text()).toBe("true");
    });

    it("propagates explicitness through a multi-level provider chain", () => {
      const Display = makeDisplay();
      const wrapper = mount(CopilotChatConfigurationProvider, {
        props: { threadId: "level-1" },
        slots: {
          default: () =>
            h(
              CopilotChatConfigurationProvider,
              {},
              {
                default: () =>
                  h(
                    CopilotChatConfigurationProvider,
                    {},
                    { default: () => h(Display) },
                  ),
              },
            ),
        },
      });

      expect(wrapper.find("[data-testid=explicit]").text()).toBe("true");
    });

    it("non-explicit parent does not prevent an explicit child from being explicit", () => {
      const Display = makeDisplay();
      const wrapper = mount(CopilotChatConfigurationProvider, {
        props: {},
        slots: {
          default: () =>
            h(
              CopilotChatConfigurationProvider,
              { threadId: "child-thread" },
              { default: () => h(Display) },
            ),
        },
      });

      expect(wrapper.find("[data-testid=explicit]").text()).toBe("true");
    });
  });

  it("inherits modal state from parent when child does not define isModalDefaultOpen", async () => {
    const ChildDisplay = defineComponent({
      setup() {
        const config = useCopilotChatConfiguration();
        return () =>
          h(
            "span",
            { "data-testid": "child-modal" },
            String(config.value?.isModalOpen),
          );
      },
    });

    const ParentToggle = defineComponent({
      setup() {
        const config = useCopilotChatConfiguration();
        const close = () => config.value?.setModalOpen?.(false);
        return () =>
          h("div", [
            h(
              "button",
              { "data-testid": "close-parent", onClick: close },
              "close",
            ),
            h(
              CopilotChatConfigurationProvider,
              { threadId: "child" },
              { default: () => h(ChildDisplay) },
            ),
          ]);
      },
    });

    const wrapper = mount(CopilotChatConfigurationProvider, {
      props: {
        threadId: "parent",
        isModalDefaultOpen: true,
      },
      slots: { default: () => h(ParentToggle) },
    });

    expect(wrapper.find("[data-testid=child-modal]").text()).toBe("true");
    await wrapper.find("[data-testid=close-parent]").trigger("click");
    await nextTick();
    await nextTick();
    expect(wrapper.find("[data-testid=child-modal]").text()).toBe("false");
  });
});

function harness(providerProps: Record<string, unknown>) {
  let cfg!: ReturnType<typeof useCopilotChatConfiguration>;
  const Probe = defineComponent({
    setup() {
      cfg = useCopilotChatConfiguration();
      return () => h("div", cfg.value?.threadId ?? "none");
    },
  });
  mount(CopilotChatConfigurationProvider, {
    props: providerProps,
    slots: { default: () => h(Probe) },
  });
  return () => cfg.value!;
}

describe("CopilotChatConfiguration active-thread setters", () => {
  it("setActiveThreadId overrides a non-explicit seed and flags it explicit", async () => {
    // A <CopilotKit>-style non-explicit seed: threadId prop + hasExplicitThreadId=false.
    const cfg = harness({ threadId: "seed-uuid", hasExplicitThreadId: false });
    cfg().setActiveThreadId("picked-thread");
    await nextTick();
    expect(cfg().threadId).toBe("picked-thread");
    expect(cfg().hasExplicitThreadId).toBe(true);
  });

  it("startNewThread mints a fresh non-explicit thread", async () => {
    const cfg = harness({ threadId: "seed-uuid", hasExplicitThreadId: false });
    cfg().setActiveThreadId("picked-thread");
    await nextTick();
    cfg().startNewThread();
    await nextTick();
    expect(cfg().threadId).not.toBe("picked-thread");
    expect(cfg().hasExplicitThreadId).toBe(false);
  });

  it("a caller-authoritative threadId prop is NOT overridable", async () => {
    const cfg = harness({ threadId: "controlled" }); // no hasExplicitThreadId => authoritative
    cfg().setActiveThreadId("ignored");
    await nextTick();
    expect(cfg().threadId).toBe("controlled");
  });
});

/** A provider nested in another; returns the outer and inner configurations. */
function nestedHarness(
  outerProps: Record<string, unknown>,
  innerProps: Record<string, unknown>,
) {
  let outer!: ReturnType<typeof useCopilotChatConfiguration>;
  let inner!: ReturnType<typeof useCopilotChatConfiguration>;
  const OuterProbe = defineComponent({
    setup(_, { slots }) {
      outer = useCopilotChatConfiguration();
      return () => slots.default?.();
    },
  });
  const InnerProbe = defineComponent({
    setup() {
      inner = useCopilotChatConfiguration();
      return () => h("div", inner.value?.threadId ?? "none");
    },
  });
  mount(CopilotChatConfigurationProvider, {
    props: outerProps,
    slots: {
      default: () =>
        h(OuterProbe, null, {
          default: () =>
            h(CopilotChatConfigurationProvider, innerProps, {
              default: () => h(InnerProbe),
            }),
        }),
    },
  });
  return { outer: () => outer.value!, inner: () => inner.value! };
}

describe("CopilotChatConfiguration active-thread setters in a nested chain", () => {
  it("a set from an uncontrolled child under a non-explicit seed parent switches the thread", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { inner } = nestedHarness(
      { threadId: "auto-minted-seed", hasExplicitThreadId: false },
      {},
    );
    expect(inner().threadId).toBe("auto-minted-seed");

    inner().setActiveThreadId("picked-thread");
    await nextTick();

    expect(inner().threadId).toBe("picked-thread");
    expect(inner().hasExplicitThreadId).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("a nested provider you add keeps its own thread", async () => {
    const { outer, inner } = nestedHarness({}, {});
    const outerThread = outer().threadId;

    inner().setActiveThreadId("picked-thread");
    await nextTick();
    expect(inner().threadId).toBe("picked-thread");
    expect(outer().threadId).toBe(outerThread);

    inner().startNewThread();
    await nextTick();
    expect(inner().threadId).not.toBe("picked-thread");
    expect(outer().threadId).toBe(outerThread);
  });

  it("a nested non-explicit seed wins over the parent's thread", () => {
    const { inner } = nestedHarness(
      { threadId: "outer-thread" },
      { threadId: "inner-seed", hasExplicitThreadId: false },
    );
    expect(inner().threadId).toBe("inner-seed");
  });

  it("sibling providers switch threads independently", async () => {
    let first!: ReturnType<typeof useCopilotChatConfiguration>;
    let second!: ReturnType<typeof useCopilotChatConfiguration>;
    const probe = (assign: (cfg: typeof first) => void) =>
      defineComponent({
        setup() {
          const cfg = useCopilotChatConfiguration();
          assign(cfg);
          return () => h("div", cfg.value?.threadId);
        },
      });
    const First = probe((cfg) => (first = cfg));
    const Second = probe((cfg) => (second = cfg));
    mount(CopilotChatConfigurationProvider, {
      props: { threadId: "page-seed", hasExplicitThreadId: false },
      slots: {
        default: () => [
          h(CopilotChatConfigurationProvider, null, {
            default: () => h(First),
          }),
          h(CopilotChatConfigurationProvider, null, {
            default: () => h(Second),
          }),
        ],
      },
    });

    first.value!.setActiveThreadId("first-thread");
    await nextTick();
    expect(first.value!.threadId).toBe("first-thread");
    expect(second.value!.threadId).toBe("page-seed");

    second.value!.startNewThread();
    await nextTick();
    expect(first.value!.threadId).toBe("first-thread");
    expect(second.value!.threadId).not.toBe("page-seed");
  });

  it("a forwardThreadSwitching child switches the thread of the provider above", async () => {
    // CopilotChat's own provider: a derived, non-explicit threadId under the
    // provider that owns the thread.
    const { outer, inner } = nestedHarness(
      {},
      {
        threadId: "derived",
        hasExplicitThreadId: false,
        forwardThreadSwitching: true,
      },
    );

    inner().setActiveThreadId("picked-thread");
    await nextTick();
    expect(outer().threadId).toBe("picked-thread");
    expect(outer().hasExplicitThreadId).toBe(true);
    expect(inner().hasExplicitThreadId).toBe(true);

    inner().startNewThread();
    await nextTick();
    expect(outer().threadId).not.toBe("picked-thread");
    expect(outer().hasExplicitThreadId).toBe(false);
  });

  it("a set from inside a controlled nested provider no-ops + warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { inner } = nestedHarness(
      {},
      { threadId: "pinned-inner", forwardThreadSwitching: true },
    );

    inner().setActiveThreadId("ignored");
    inner().startNewThread();
    await nextTick();

    expect(inner().threadId).toBe("pinned-inner");
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe("CopilotChatConfiguration threadId prop", () => {
  it("starts a fresh thread when the threadId prop is cleared", async () => {
    let cfg!: ReturnType<typeof useCopilotChatConfiguration>;
    const Probe = defineComponent({
      setup() {
        cfg = useCopilotChatConfiguration();
        return () => h("div", cfg.value?.threadId);
      },
    });
    const wrapper = mount(CopilotChatConfigurationProvider, {
      props: { threadId: undefined as string | undefined },
      slots: { default: () => h(Probe) },
    });
    const mountThread = cfg.value!.threadId;

    await wrapper.setProps({ threadId: "chosen" });
    expect(cfg.value!.threadId).toBe("chosen");

    await wrapper.setProps({ threadId: undefined });
    expect(cfg.value!.threadId).not.toBe("chosen");
    expect(cfg.value!.threadId).not.toBe(mountThread);
    expect(cfg.value!.hasExplicitThreadId).toBe(false);
  });
});

describe("CopilotChatConfiguration drawer-awareness", () => {
  it("registerDrawer flips drawerRegistered and cleans up", async () => {
    const cfg = harness({ isModalDefaultOpen: true });
    expect(cfg().drawerRegistered).toBe(false);
    const unregister = cfg().registerDrawer();
    await nextTick();
    expect(cfg().drawerRegistered).toBe(true);
    unregister();
    await nextTick();
    expect(cfg().drawerRegistered).toBe(false);
  });

  it("opening the drawer on mobile closes the modal", async () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
    } as MediaQueryList);
    const cfg = harness({ isModalDefaultOpen: true });
    expect(cfg().isModalOpen).toBe(true);
    cfg().setDrawerOpen(true);
    await nextTick();
    expect(cfg().drawerOpen).toBe(true);
    expect(cfg().isModalOpen).toBe(false);
    vi.restoreAllMocks();
  });

  it("opening the modal on mobile closes the drawer", async () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
    } as MediaQueryList);
    const cfg = harness({ isModalDefaultOpen: true });

    // First open the drawer (closing the modal via the existing exclusion).
    cfg().setDrawerOpen(true);
    await nextTick();
    expect(cfg().drawerOpen).toBe(true);
    expect(cfg().isModalOpen).toBe(false);

    // Now open the modal and confirm the reverse exclusion closes the drawer.
    cfg().setModalOpen(true);
    await nextTick();
    expect(cfg().isModalOpen).toBe(true);
    expect(cfg().drawerOpen).toBe(false);
    vi.restoreAllMocks();
  });
});

describe("CopilotChatConfiguration modal-setter presence contract", () => {
  it("bare provider (no isModalDefaultOpen, no parent) exposes setModalOpen as undefined", () => {
    const cfg = harness({ threadId: "thread-1" });
    expect(cfg().setModalOpen).toBeUndefined();
  });

  it("provider with isModalDefaultOpen exposes a working setModalOpen", async () => {
    const cfg = harness({ isModalDefaultOpen: true });
    expect(typeof cfg().setModalOpen).toBe("function");
    cfg().setModalOpen(false);
    await nextTick();
    expect(cfg().isModalOpen).toBe(false);
  });
});
