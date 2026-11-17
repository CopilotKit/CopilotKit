import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import { useCopilotChatConfiguration } from "../../../providers/useCopilotChatConfiguration";
import { CopilotModalHeader } from "../index";

function mockMatchMedia(matches: boolean) {
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches,
    media: "(max-width: 767px)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList);
}

function makeProbe(
  onConfig: (cfg: ReturnType<typeof useCopilotChatConfiguration>) => void,
) {
  return defineComponent({
    setup() {
      const config = useCopilotChatConfiguration();
      onConfig(config);
      return () => h("span", { "data-testid": "probe" });
    },
  });
}

describe("CopilotModalHeader drawer launcher", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not render the launcher when no drawer is registered (mobile)", () => {
    mockMatchMedia(true);

    const wrapper = mount(CopilotKitProvider, {
      props: { runtimeUrl: "/api/copilotkit" },
      slots: {
        default: () =>
          h(
            CopilotChatConfigurationProvider,
            { isModalDefaultOpen: true },
            { default: () => h(CopilotModalHeader) },
          ),
      },
    });

    expect(wrapper.find('[data-testid="drawer-launcher"]').exists()).toBe(
      false,
    );
  });

  it("renders the launcher and toggles drawerOpen when registered on mobile", async () => {
    mockMatchMedia(true);

    let cfg!: ReturnType<typeof useCopilotChatConfiguration>;
    const Probe = makeProbe((config) => {
      cfg = config;
    });

    const wrapper = mount(CopilotKitProvider, {
      props: { runtimeUrl: "/api/copilotkit" },
      slots: {
        default: () =>
          h(
            CopilotChatConfigurationProvider,
            { isModalDefaultOpen: true },
            { default: () => [h(CopilotModalHeader), h(Probe)] },
          ),
      },
    });

    // No drawer registered yet -> no launcher.
    expect(wrapper.find('[data-testid="drawer-launcher"]').exists()).toBe(
      false,
    );

    cfg.value?.registerDrawer();
    await nextTick();

    const launcher = wrapper.find('[data-testid="drawer-launcher"]');
    expect(launcher.exists()).toBe(true);

    expect(cfg.value?.drawerOpen).toBe(false);
    await launcher.trigger("click");

    expect(cfg.value?.drawerOpen).toBe(true);
    // Mobile mutual-exclusion: opening the drawer closes the modal.
    expect(cfg.value?.isModalOpen).toBe(false);
  });

  it("does not render the launcher on desktop even when a drawer is registered", async () => {
    mockMatchMedia(false);

    let cfg!: ReturnType<typeof useCopilotChatConfiguration>;
    const Probe = makeProbe((config) => {
      cfg = config;
    });

    const wrapper = mount(CopilotKitProvider, {
      props: { runtimeUrl: "/api/copilotkit" },
      slots: {
        default: () =>
          h(
            CopilotChatConfigurationProvider,
            { isModalDefaultOpen: true },
            { default: () => [h(CopilotModalHeader), h(Probe)] },
          ),
      },
    });

    cfg.value?.registerDrawer();
    await nextTick();

    expect(wrapper.find('[data-testid="drawer-launcher"]').exists()).toBe(
      false,
    );
  });
});
