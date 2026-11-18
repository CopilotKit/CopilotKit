import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import type { CopilotChatLabels } from "@copilotkit/core";
import CopilotChatConfigurationProvider from "../../providers/CopilotChatConfigurationProvider.vue";
import InlineFeatureWarning from "../InlineFeatureWarning.vue";
import LicenseWarningBanner from "../LicenseWarningBanner.vue";

/** Mounts `child` inside a chat configuration with `labels`. */
function mountWithLabels(
  labels: Partial<CopilotChatLabels>,
  child: () => ReturnType<typeof h>,
) {
  const Host = defineComponent({
    setup: () => () =>
      h(CopilotChatConfigurationProvider, { labels }, { default: child }),
  });
  return mount(Host);
}

// The banner text rules are covered next to core's ɵgetLicenseBannerSpec.
describe("LicenseWarningBanner", () => {
  it("reactively renders and invokes the optional dismiss callback", async () => {
    const onDismiss = vi.fn();
    const wrapper = mount(LicenseWarningBanner, {
      props: { type: "no_license" },
    });

    expect(wrapper.find("button").exists()).toBe(false);

    await wrapper.setProps({ onDismiss });
    await wrapper.get("button").trigger("click");

    expect(onDismiss).toHaveBeenCalledOnce();

    await wrapper.setProps({ onDismiss: undefined });

    expect(wrapper.find("button").exists()).toBe(false);
  });

  it("shows the core spec's text and link", () => {
    const wrapper = mount(LicenseWarningBanner, {
      props: { type: "expiring", graceRemaining: 1 },
    });

    expect(wrapper.get("span").text()).toBe(
      "Your CopilotKit license expires in 1 day. Please renew.",
    );
    expect(wrapper.get("a").attributes("href")).toBe(
      "https://dashboard.operations.copilotkit.ai",
    );
  });

  it("uses the configured chat labels", () => {
    const wrapper = mountWithLabels(
      { licenseInvalidText: "Token ungültig" },
      () => h(LicenseWarningBanner, { type: "invalid" }),
    );

    expect(wrapper.get("span").text()).toBe("Token ungültig");
  });
});

describe("InlineFeatureWarning", () => {
  it("shows the default feature-unlicensed label", () => {
    const wrapper = mount(InlineFeatureWarning, {
      props: { featureName: "Chat" },
    });

    expect(wrapper.text()).toContain(
      '⚠ The "Chat" feature requires a CopilotKit license.',
    );
  });

  it("uses the configured feature-unlicensed label", () => {
    const wrapper = mountWithLabels(
      { licenseFeatureUnlicensedText: "{feature} braucht eine Lizenz." },
      () => h(InlineFeatureWarning, { featureName: "Chat" }),
    );

    expect(wrapper.text()).toContain("Chat braucht eine Lizenz.");
  });
});
