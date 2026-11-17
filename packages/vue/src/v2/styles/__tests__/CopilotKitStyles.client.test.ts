import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createApp,
  createSSRApp,
  defineComponent,
  h,
  nextTick,
  ref,
} from "vue";
import type { Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { mount } from "@vue/test-utils";
import type { VueWrapper } from "@vue/test-utils";
import { stylesheet } from "@copilotkit/core/styles";
import CopilotKitProvider from "../../providers/CopilotKitProvider.vue";
import { StateCapturingAgent } from "../../__tests__/utils/agents";
import CopilotChat from "../../components/chat/CopilotChat.vue";
import CopilotKitV1 from "../../../components/copilot-provider/CopilotKit.vue";
import { CopilotKitStyles } from "../CopilotKitStyles";

const styleTags = () =>
  document.querySelectorAll("style[data-copilotkit-styles]");

let wrapper: VueWrapper | undefined;

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = "";
});

function mountWithProvider(
  children: () => unknown,
  providerProps: Record<string, unknown> = {},
  provider: Component = CopilotKitProvider as Component,
) {
  wrapper = mount(provider, {
    attachTo: document.body,
    props: {
      agents__unsafe_dev_only: { default: new StateCapturingAgent() },
      ...providerProps,
    },
    slots: { default: children },
  });
  return wrapper;
}

describe("CopilotKitStyles in the browser", () => {
  it("is rendered by CopilotChat, so apps don't import a stylesheet", () => {
    mountWithProvider(() => h(CopilotChat, { welcomeScreen: false }));

    const tags = styleTags();
    expect(tags).toHaveLength(1);
    expect(tags[0]!.textContent).toBe(stylesheet);
  });

  it("keeps one copy for many chats, and keeps it while any chat is mounted", async () => {
    const showFirst = ref(true);
    const showSecond = ref(true);
    mountWithProvider(() => [
      showFirst.value ? h(CopilotChat, { welcomeScreen: false }) : null,
      showSecond.value ? h(CopilotChat, { welcomeScreen: false }) : null,
    ]);
    expect(styleTags()).toHaveLength(1);

    // The first chat owns the tag. Unmounting it hands the tag on.
    showFirst.value = false;
    await nextTick();
    expect(styleTags()).toHaveLength(1);

    showFirst.value = true;
    await nextTick();
    expect(styleTags()).toHaveLength(1);

    showFirst.value = false;
    showSecond.value = false;
    await nextTick();
    expect(styleTags()).toHaveLength(0);
  });

  it("adds the CSP nonce to the style tag", () => {
    mountWithProvider(() => h(CopilotKitStyles), { nonce: "abc123" });

    const tags = styleTags();
    expect(tags).toHaveLength(1);
    expect(tags[0]!.getAttribute("nonce")).toBe("abc123");
  });

  it("adds no style tag when the app loads styles.css itself", () => {
    mountWithProvider(() => h(CopilotChat, { welcomeScreen: false }), {
      injectStyles: false,
    });

    expect(styleTags()).toHaveLength(0);
    expect(document.querySelectorAll("style")).toHaveLength(0);
  });

  it("injects through the v1 CopilotKit provider by default", () => {
    mountWithProvider(() => h(CopilotKitStyles), {}, CopilotKitV1 as Component);

    expect(styleTags()).toHaveLength(1);
  });

  it("injects without a provider", () => {
    wrapper = mount(CopilotKitStyles, { attachTo: document.body });

    expect(styleTags()).toHaveLength(1);
  });

  it("hydrates the server-rendered tag without a mismatch", async () => {
    const Page = defineComponent({
      render: () =>
        h(
          CopilotKitProvider as Component,
          { agents__unsafe_dev_only: { default: new StateCapturingAgent() } },
          { default: () => [h(CopilotKitStyles), h(CopilotKitStyles)] },
        ),
    });
    const container = document.createElement("div");
    container.innerHTML = await renderToString(createSSRApp(Page));
    document.body.appendChild(container);
    const serverTag = styleTags()[0];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const app = createSSRApp(Page);
    app.mount(container);
    await nextTick();

    const mismatches = [...warn.mock.calls, ...error.mock.calls].filter(
      (args) => String(args[0]).includes("Hydration"),
    );
    expect(mismatches).toEqual([]);
    expect(styleTags()).toHaveLength(1);
    expect(styleTags()[0]).toBe(serverTag);
    app.unmount();
  });

  it("gives separate apps on one page their own copy", () => {
    const first = createApp({ render: () => h(CopilotKitStyles) });
    const second = createApp({ render: () => h(CopilotKitStyles) });
    first.mount(document.body.appendChild(document.createElement("div")));
    second.mount(document.body.appendChild(document.createElement("div")));

    expect(styleTags()).toHaveLength(2);
    first.unmount();
    second.unmount();
  });
});
