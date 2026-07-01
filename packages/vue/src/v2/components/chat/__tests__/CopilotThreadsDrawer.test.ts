import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

const HasExplicitThreadIdProbe = {
  setup() {
    const config = useCopilotChatConfiguration();
    return () =>
      h(
        "span",
        { "data-testid": "has-explicit-thread-id" },
        String(config.value?.hasExplicitThreadId),
      );
  },
};

// Deterministic, controllable stand-in for the real `useThreads` composable so
// delete/active-thread behavior can be asserted without a live runtime. Reset
// per-test in `beforeEach`.
const useThreadsMocks = vi.hoisted(() => ({
  deleteThread: vi.fn().mockResolvedValue(undefined),
  startNewThread: vi.fn(),
}));

vi.mock("../../../hooks/use-threads", () => ({
  useThreads: () => ({
    threads: { value: [] },
    isLoading: { value: false },
    error: { value: null },
    listError: { value: null },
    hasMoreThreads: { value: false },
    isFetchingMoreThreads: { value: false },
    isMutating: { value: false },
    fetchMoreThreads: vi.fn(),
    refetchThreads: vi.fn(),
    startNewThread: useThreadsMocks.startNewThread,
    renameThread: vi.fn().mockResolvedValue(undefined),
    archiveThread: vi.fn().mockResolvedValue(undefined),
    unarchiveThread: vi.fn().mockResolvedValue(undefined),
    deleteThread: useThreadsMocks.deleteThread,
  }),
}));

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

  beforeEach(() => {
    useThreadsMocks.deleteThread.mockClear();
    useThreadsMocks.deleteThread.mockResolvedValue(undefined);
    useThreadsMocks.startNewThread.mockClear();
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

  it("returns focus to the chat input after a thread is selected", async () => {
    // Real focusable element carrying the Vue chat input's documented
    // testid, planted in the live DOM alongside the drawer (mountDrawer
    // attaches to document.body). Against the pre-fix selector
    // (`copilot-chat-textarea`, which does not exist in Vue) this never
    // matches and `document.activeElement` stays on <body> — red.
    const input = document.createElement("textarea");
    input.setAttribute("data-testid", "copilot-chat-input-textarea");
    document.body.appendChild(input);

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

    expect(document.activeElement).toBe(input);

    wrapper.unmount();
    input.remove();
  });

  it("resets the active thread when the ACTIVE thread is deleted", async () => {
    const wrapper = mountDrawer({}, [
      h(ThreadIdProbe),
      h(HasExplicitThreadIdProbe),
    ]);
    await nextTick();
    await nextTick();

    const el = wrapper.find(COPILOTKIT_THREADS_DRAWER_TAG).element;

    // Seed the active thread via an explicit selection first.
    el.dispatchEvent(
      new CustomEvent("thread-selected", {
        detail: { threadId: "t-active" },
        bubbles: true,
        composed: true,
      }),
    );
    await nextTick();
    expect(wrapper.get("[data-testid='thread-id']").text()).toBe("t-active");
    expect(wrapper.get("[data-testid='has-explicit-thread-id']").text()).toBe(
      "true",
    );

    el.dispatchEvent(
      new CustomEvent("delete", {
        detail: { threadId: "t-active" },
        bubbles: true,
        composed: true,
      }),
    );
    // Let the deleteThread() promise resolve and its .then() run.
    await nextTick();
    await nextTick();
    await nextTick();

    expect(useThreadsMocks.deleteThread).toHaveBeenCalledWith("t-active");
    expect(useThreadsMocks.startNewThread).toHaveBeenCalledTimes(1);
    expect(wrapper.get("[data-testid='thread-id']").text()).not.toBe(
      "t-active",
    );
    expect(wrapper.get("[data-testid='has-explicit-thread-id']").text()).toBe(
      "false",
    );

    wrapper.unmount();
  });

  it("leaves the active thread intact when a NON-active thread is deleted", async () => {
    const wrapper = mountDrawer({}, [h(ThreadIdProbe)]);
    await nextTick();
    await nextTick();

    const el = wrapper.find(COPILOTKIT_THREADS_DRAWER_TAG).element;

    el.dispatchEvent(
      new CustomEvent("thread-selected", {
        detail: { threadId: "t-active" },
        bubbles: true,
        composed: true,
      }),
    );
    await nextTick();
    expect(wrapper.get("[data-testid='thread-id']").text()).toBe("t-active");

    el.dispatchEvent(
      new CustomEvent("delete", {
        detail: { threadId: "t-other" },
        bubbles: true,
        composed: true,
      }),
    );
    await nextTick();
    await nextTick();
    await nextTick();

    expect(useThreadsMocks.deleteThread).toHaveBeenCalledWith("t-other");
    expect(useThreadsMocks.startNewThread).not.toHaveBeenCalled();
    expect(wrapper.get("[data-testid='thread-id']").text()).toBe("t-active");

    wrapper.unmount();
  });

  it("starts closed and reflects open-change via the local fallback when there is no configuration provider", async () => {
    const wrapper = mount(CopilotKitProvider, {
      props: { runtimeUrl: "/api/copilotkit" },
      slots: {
        default: () => h(CopilotThreadsDrawer, {}),
      },
      attachTo: document.body,
    });
    await nextTick();
    await nextTick();

    const el = wrapper.find(COPILOTKIT_THREADS_DRAWER_TAG)
      .element as HTMLElement & Record<string, unknown>;

    expect(el.open).toBe(false);

    el.dispatchEvent(
      new CustomEvent("open-change", {
        detail: { open: true },
        bubbles: true,
        composed: true,
      }),
    );
    await nextTick();

    expect(el.open).toBe(true);

    wrapper.unmount();
  });
});

describe("CopilotThreadsDrawer package export", () => {
  it("is exported from the package entry", () => {
    expect((vue as Record<string, unknown>).CopilotThreadsDrawer).toBeDefined();
  });
});
