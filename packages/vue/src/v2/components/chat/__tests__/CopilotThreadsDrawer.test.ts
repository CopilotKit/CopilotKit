import { beforeAll, describe, expect, it, vi } from "vitest";
import { h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import { useCopilotChatConfiguration } from "../../../providers/useCopilotChatConfiguration";
import CopilotThreadsDrawer from "../CopilotThreadsDrawer.vue";
import {
  COPILOTKIT_THREADS_DRAWER_TAG,
  defineCopilotKitThreadsDrawer,
} from "@copilotkit/web-components/threads-drawer";
// The package name `@copilotkit/vue` does not resolve from within its own
// test suite (no build output / self-referencing node_modules symlink in
// this workspace), so the package entry barrel is imported by relative
// path here. This still verifies the full re-export chain from the chat
// barrel up through components/index.ts and v2/index.ts to the package
// root entry.
import * as vue from "../../../../index";

const ThreadIdProbe = {
  setup() {
    const config = useCopilotChatConfiguration();
    return () =>
      h("span", { "data-testid": "thread-id" }, String(config.value?.threadId));
  },
};

function mountDrawer(
  props: Record<string, unknown> = {},
  extraSlotChildren: unknown[] = [],
) {
  return mount(CopilotKitProvider, {
    props: { runtimeUrl: "/api/copilotkit" },
    slots: {
      default: () =>
        h(
          CopilotChatConfigurationProvider,
          { isModalDefaultOpen: true },
          {
            default: () => [
              h(CopilotThreadsDrawer, props),
              ...extraSlotChildren,
            ],
          },
        ),
    },
    attachTo: document.body,
  });
}

describe("CopilotThreadsDrawer", () => {
  beforeAll(() => {
    // Belt-and-braces: ensure the custom element is registered even if
    // onMounted timing is flaky in the jsdom test env.
    defineCopilotKitThreadsDrawer();
  });

  it("renders the custom element and sets domain properties", async () => {
    const wrapper = mountDrawer({ label: "Chats" });
    await nextTick();
    await nextTick();

    const el = wrapper.find(COPILOTKIT_THREADS_DRAWER_TAG)
      .element as HTMLElement & Record<string, unknown>;

    expect(el).toBeTruthy();
    expect(Array.isArray(el.threads)).toBe(true);
    expect(el.label).toBe("Chats");
    // Unlicensed-by-default test runtime -> license status is null (pending).
    // Pending must never flash the locked view: loading true, licensed true.
    expect(el.loading).toBe(true);
    expect(el.licensed).toBe(true);

    wrapper.unmount();
  });

  it("routes thread-selected to the config's setActiveThreadId", async () => {
    const wrapper = mountDrawer({}, [h(ThreadIdProbe)]);
    await nextTick();
    await nextTick();

    const el = wrapper.find(COPILOTKIT_THREADS_DRAWER_TAG).element;
    el.dispatchEvent(
      new CustomEvent("thread-selected", {
        detail: { threadId: "t-42" },
        bubbles: true,
        composed: true,
      }),
    );
    await nextTick();

    expect(wrapper.get("[data-testid='thread-id']").text()).toBe("t-42");

    wrapper.unmount();
  });

  it("invokes onLicensed when the element emits licensed", async () => {
    const onLicensed = vi.fn();
    const wrapper = mountDrawer({ onLicensed });
    await nextTick();
    await nextTick();

    const el = wrapper.find(COPILOTKIT_THREADS_DRAWER_TAG).element;
    el.dispatchEvent(
      new CustomEvent("licensed", {
        detail: { licenseUrl: null },
        bubbles: true,
        composed: true,
      }),
    );
    await nextTick();

    expect(onLicensed).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });
});

describe("CopilotThreadsDrawer package export", () => {
  it("is exported from the package entry", () => {
    expect((vue as Record<string, unknown>).CopilotThreadsDrawer).toBeDefined();
  });
});
