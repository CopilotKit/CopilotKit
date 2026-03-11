import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import { DEFAULT_AGENT_ID } from "@copilotkitnext/shared";
import CopilotChatConfigurationProvider from "../CopilotChatConfigurationProvider.vue";
import { useCopilotChatConfiguration } from "../useCopilotChatConfiguration";
import { CopilotChatDefaultLabels } from "../types";

function makeDisplay() {
  return defineComponent({
    setup() {
      const config = useCopilotChatConfiguration();
      return () =>
        h("div", [
          h("span", { "data-testid": "agent" }, config.value?.agentId ?? "no-config"),
          h("span", { "data-testid": "thread" }, config.value?.threadId ?? "no-config"),
          h("span", { "data-testid": "placeholder" }, config.value?.labels.chatInputPlaceholder ?? "no-config"),
          h(
            "span",
            { "data-testid": "copy" },
            config.value?.labels.assistantMessageToolbarCopyMessageLabel ?? "no-config",
          ),
          h("span", { "data-testid": "modal" }, String(config.value?.isModalOpen)),
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
    expect(wrapper.find("[data-testid=placeholder]").text()).toBe("Custom Placeholder");
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
            h("span", { "data-testid": "modal" }, String(config.value?.isModalOpen)),
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

  it("inherits modal state from parent when child does not define isModalDefaultOpen", async () => {
    const ChildDisplay = defineComponent({
      setup() {
        const config = useCopilotChatConfiguration();
        return () => h("span", { "data-testid": "child-modal" }, String(config.value?.isModalOpen));
      },
    });

    const ParentToggle = defineComponent({
      setup() {
        const config = useCopilotChatConfiguration();
        const close = () => config.value?.setModalOpen?.(false);
        return () =>
          h("div", [
            h("button", { "data-testid": "close-parent", onClick: close }, "close"),
            h(CopilotChatConfigurationProvider, { threadId: "child" }, { default: () => h(ChildDisplay) }),
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
