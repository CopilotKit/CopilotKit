import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import LicenseWarningBanner from "../LicenseWarningBanner.vue";

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
});
