import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, provide, ref } from "vue";
import { render, cleanup } from "@testing-library/vue";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import {
  LicenseContextKey,
  type LicenseContextValue,
} from "../../../providers/license-context";
import { StateCapturingAgent } from "../../../__tests__/utils/agents";
import CopilotChat from "../CopilotChat.vue";
import CopilotSidebar from "../CopilotSidebar.vue";
import CopilotPopup from "../CopilotPopup.vue";

/**
 * Vue parity tests for the inline feature warning surfaces on
 * `CopilotChat`, `CopilotSidebar`, and `CopilotPopup`. Mirrors the React
 * inline warning + console.warn behavior at:
 *   packages/react-core/src/v2/components/chat/CopilotChat.tsx
 *   packages/react-core/src/v2/components/chat/CopilotSidebar.tsx
 *   packages/react-core/src/v2/components/chat/CopilotPopup.tsx
 *
 * The default `createLicenseContextValue(null)` is permissive
 * (`checkFeature` always returns true), so the inline warning is never
 * rendered in the default path. We test both the default path
 * (no warning) and an explicit gated path (warning rendered + console
 * warned) by overriding the injected license context.
 */

function makeLicenseRef(licensed: boolean) {
  const value: LicenseContextValue = {
    status: null,
    license: null,
    checkFeature: () => licensed,
    getLimit: () => null,
  };
  return ref(value);
}

function mountWith(opts: {
  licensed: boolean;
  component: typeof CopilotChat | typeof CopilotSidebar | typeof CopilotPopup;
}) {
  // The CopilotKitProvider re-`provide`s `LicenseContextKey` with the
  // permissive default. To override it for these tests, install our custom
  // license ref on a wrapper rendered *inside* the provider.
  const LicenseOverride = defineComponent({
    setup(_, { slots }) {
      provide(LicenseContextKey, makeLicenseRef(opts.licensed));
      return () => slots.default?.();
    },
  });

  const Host = defineComponent({
    setup() {
      return () =>
        h(
          CopilotKitProvider,
          { agents__unsafe_dev_only: { default: new StateCapturingAgent() } },
          {
            default: () =>
              h(LicenseOverride, null, {
                default: () =>
                  h(
                    CopilotChatConfigurationProvider,
                    { threadId: "test-thread" },
                    {
                      default: () => h(opts.component),
                    },
                  ),
              }),
          },
        );
    },
  });
  return render(Host);
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CopilotChat license inline warning", () => {
  it("does not render an inline warning under the default permissive license context", () => {
    const view = mountWith({ licensed: true, component: CopilotChat });
    expect(view.queryByTestId("copilot-inline-feature-warning")).toBeNull();
  });

  it('renders the "Chat" inline warning and console-warns when chat is unlicensed', () => {
    const view = mountWith({ licensed: false, component: CopilotChat });
    const warning = view.getByTestId("copilot-inline-feature-warning");
    expect(warning.textContent).toContain("Chat");
    expect(warnSpy).toHaveBeenCalledWith(
      '[CopilotKit] Warning: "chat" feature is not licensed. Visit copilotkit.ai/pricing',
    );
  });
});

describe("CopilotSidebar license inline warning", () => {
  it("does not render an inline warning under the default permissive license context", () => {
    const view = mountWith({ licensed: true, component: CopilotSidebar });
    expect(view.queryByTestId("copilot-inline-feature-warning")).toBeNull();
  });

  it('renders the "Sidebar" inline warning and console-warns when sidebar is unlicensed', () => {
    const view = mountWith({ licensed: false, component: CopilotSidebar });
    const warnings = view.getAllByTestId("copilot-inline-feature-warning");
    // Sidebar wraps CopilotChat, so the wrapper warning + the chat warning
    // both render. The sidebar warning is emitted first in DOM order.
    expect(warnings[0]?.textContent).toContain("Sidebar");
    expect(warnSpy).toHaveBeenCalledWith(
      '[CopilotKit] Warning: "sidebar" feature is not licensed. Visit copilotkit.ai/pricing',
    );
  });
});

describe("CopilotPopup license inline warning", () => {
  it("does not render an inline warning under the default permissive license context", () => {
    const view = mountWith({ licensed: true, component: CopilotPopup });
    expect(view.queryByTestId("copilot-inline-feature-warning")).toBeNull();
  });

  it('renders the "Popup" inline warning and console-warns when popup is unlicensed', () => {
    const view = mountWith({ licensed: false, component: CopilotPopup });
    const warnings = view.getAllByTestId("copilot-inline-feature-warning");
    expect(warnings[0]?.textContent).toContain("Popup");
    expect(warnSpy).toHaveBeenCalledWith(
      '[CopilotKit] Warning: "popup" feature is not licensed. Visit copilotkit.ai/pricing',
    );
  });
});
