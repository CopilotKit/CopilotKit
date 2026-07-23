import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { h, nextTick, toValue } from "vue";
import type { MaybeRefOrGetter } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import { useCopilotChatConfiguration } from "../../../providers/useCopilotChatConfiguration";
import CopilotThreadsDrawer from "../CopilotThreadsDrawer.vue";
import {
  COPILOTKIT_THREADS_DRAWER_TAG,
  defineCopilotKitThreadsDrawer,
} from "@copilotkit/web-components/threads-drawer";
import type { CopilotKitThreadsDrawer as CopilotKitThreadsDrawerElement } from "@copilotkit/web-components/threads-drawer";
// The package name `@copilotkit/vue` does not resolve from within its own
// test suite (no build output / self-referencing node_modules symlink in
// this workspace), so the package entry barrel is imported by relative
// path here. This still verifies the full re-export chain from the chat
// barrel up through components/index.ts and v2/index.ts to the package
// root entry.
import * as vue from "../../../../index";
import type { LicenseContextValue } from "../../../providers/license-context";
import type { Thread } from "../../../hooks/use-threads";

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

/** Reads the config-backed `drawerOpen` so `open-change` routing can be
 * asserted without reaching into the element's own `open` property (which
 * is itself derived FROM this same config value, so a separate probe keeps
 * the assertion honest about which layer actually changed). */
const DrawerOpenProbe = {
  setup() {
    const config = useCopilotChatConfiguration();
    return () =>
      h(
        "span",
        { "data-testid": "drawer-open" },
        String(config.value?.drawerOpen),
      );
  },
};

// Deterministic, controllable stand-in for the real `useThreads` composable so
// delete/active-thread behavior can be asserted without a live runtime. Reset
// per-test in `beforeEach`. `useThreadsInput` captures the input passed by the
// wrapper on the most recent call so tests can assert on `limit`/`enabled`
// forwarding (both are `MaybeRefOrGetter`, so callers must unwrap with
// `toValue`).
const useThreadsMocks = vi.hoisted(() => ({
  deleteThread: vi.fn().mockResolvedValue(undefined),
  startNewThread: vi.fn(),
  archiveThread: vi.fn().mockResolvedValue(undefined),
  unarchiveThread: vi.fn().mockResolvedValue(undefined),
  fetchMoreThreads: vi.fn(),
  refetchThreads: vi.fn(),
  listError: { value: null as Error | null },
  fetchMoreError: { value: null as Error | null },
  error: { value: null as Error | null },
  useThreadsInput: null as Record<string, unknown> | null,
  // Mutable so individual tests (e.g. row-slot projection) can seed threads;
  // reset to empty in `beforeEach`.
  threads: { value: [] as Thread[] },
}));

vi.mock("../../../hooks/use-threads", () => ({
  useThreads: (input: Record<string, unknown>) => {
    useThreadsMocks.useThreadsInput = input;
    return {
      threads: useThreadsMocks.threads,
      isLoading: { value: false },
      error: useThreadsMocks.error,
      listError: useThreadsMocks.listError,
      fetchMoreError: useThreadsMocks.fetchMoreError,
      hasMoreThreads: { value: false },
      isFetchingMoreThreads: { value: false },
      isMutating: { value: false },
      fetchMoreThreads: useThreadsMocks.fetchMoreThreads,
      refetchThreads: useThreadsMocks.refetchThreads,
      startNewThread: useThreadsMocks.startNewThread,
      renameThread: vi.fn().mockResolvedValue(undefined),
      archiveThread: useThreadsMocks.archiveThread,
      unarchiveThread: useThreadsMocks.unarchiveThread,
      deleteThread: useThreadsMocks.deleteThread,
    };
  },
}));

function makeThread(id: string): Thread {
  return {
    id,
    agentId: "test-agent",
    name: `Thread ${id}`,
    archived: false,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

// Controllable stand-in for the license context so resolved-licensed and
// resolved-unlicensed states can be driven directly, without routing a real
// runtime connection through `CopilotKitProvider`. Defaults to a permissive
// "pending" (status null) context, matching the provider's own default
// before a runtime responds, and is reset per-test in `beforeEach`.
const licenseContextMock = vi.hoisted(() => ({
  value: {
    status: null,
    license: null,
    checkFeature: () => true,
    getLimit: () => null,
  } as LicenseContextValue,
}));

vi.mock("../../../providers/useLicenseContext", () => ({
  useLicenseContext: () => ({
    get value() {
      return licenseContextMock.value;
    },
  }),
}));

// Mounts the drawer and waits for it to settle before returning. The wrapper
// registers the `<copilotkit-threads-drawer>` element ASYNCHRONOUSLY (a
// dynamic `import()` inside `onMounted`, kept lazy so `@copilotkit/vue` stays
// SSR-safe — see CopilotThreadsDrawer.vue). `flushPromises()` resolves that
// dynamic import (already cached via the static import + `beforeAll` register
// below, so it settles on a microtask) which flips `mounted` and sets
// `elementTag`; the trailing `nextTick()` flushes the resulting render plus
// the `flush: "post"` property-push watcher. Callers must `await` this.
async function mountDrawer(
  props: Record<string, unknown> = {},
  extraSlotChildren: unknown[] = [],
) {
  const wrapper = mount(CopilotKitProvider, {
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
  await flushPromises();
  await nextTick();
  return wrapper;
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
    useThreadsMocks.archiveThread.mockClear();
    useThreadsMocks.archiveThread.mockResolvedValue(undefined);
    useThreadsMocks.unarchiveThread.mockClear();
    useThreadsMocks.unarchiveThread.mockResolvedValue(undefined);
    useThreadsMocks.fetchMoreThreads.mockClear();
    useThreadsMocks.refetchThreads.mockClear();
    useThreadsMocks.listError.value = null;
    useThreadsMocks.fetchMoreError.value = null;
    useThreadsMocks.error.value = null;
    useThreadsMocks.useThreadsInput = null;
    useThreadsMocks.threads.value = [];
    licenseContextMock.value = {
      status: null,
      license: null,
      checkFeature: () => true,
      getLimit: () => null,
    };
  });

  it("renders the custom element and sets domain properties", async () => {
    const wrapper = await mountDrawer({ label: "Chats" });

    const el = wrapper.find(COPILOTKIT_THREADS_DRAWER_TAG)
      .element as unknown as CopilotKitThreadsDrawerElement;

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
    const wrapper = await mountDrawer({}, [h(ThreadIdProbe)]);

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
    const wrapper = await mountDrawer({ onLicensed });

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

    const wrapper = await mountDrawer({}, [h(ThreadIdProbe)]);

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
    const wrapper = await mountDrawer({}, [
      h(ThreadIdProbe),
      h(HasExplicitThreadIdProbe),
    ]);

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
    await flushPromises();
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
    const wrapper = await mountDrawer({}, [h(ThreadIdProbe)]);

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
    await flushPromises();
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
    await flushPromises();
    await nextTick();

    const el = wrapper.find(COPILOTKIT_THREADS_DRAWER_TAG)
      .element as unknown as CopilotKitThreadsDrawerElement;

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

  it("routes archive to threadsApi.archiveThread", async () => {
    const wrapper = await mountDrawer();

    const el = wrapper.find(COPILOTKIT_THREADS_DRAWER_TAG).element;
    el.dispatchEvent(
      new CustomEvent("archive", {
        detail: { threadId: "t-archive" },
        bubbles: true,
        composed: true,
      }),
    );
    await flushPromises();

    expect(useThreadsMocks.archiveThread).toHaveBeenCalledWith("t-archive");

    wrapper.unmount();
  });

  it("routes unarchive to threadsApi.unarchiveThread", async () => {
    const wrapper = await mountDrawer();

    const el = wrapper.find(COPILOTKIT_THREADS_DRAWER_TAG).element;
    el.dispatchEvent(
      new CustomEvent("unarchive", {
        detail: { threadId: "t-unarchive" },
        bubbles: true,
        composed: true,
      }),
    );
    await flushPromises();

    expect(useThreadsMocks.unarchiveThread).toHaveBeenCalledWith("t-unarchive");

    wrapper.unmount();
  });

  it("routes filter-change to threadsApi.refetchThreads", async () => {
    const wrapper = await mountDrawer();

    const el = wrapper.find(COPILOTKIT_THREADS_DRAWER_TAG).element;
    el.dispatchEvent(
      new CustomEvent("filter-change", {
        detail: { filter: "all" },
        bubbles: true,
        composed: true,
      }),
    );
    await nextTick();

    expect(useThreadsMocks.refetchThreads).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it("routes new-thread to threadsApi.startNewThread AND the config's startNewThread", async () => {
    const wrapper = await mountDrawer({}, [
      h(ThreadIdProbe),
      h(HasExplicitThreadIdProbe),
    ]);

    const el = wrapper.find(COPILOTKIT_THREADS_DRAWER_TAG).element;

    // Seed an explicit active thread first so the config-backed reset is
    // observable (it flips the thread id and marks it non-explicit again).
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
      new CustomEvent("new-thread", {
        detail: {},
        bubbles: true,
        composed: true,
      }),
    );
    await nextTick();

    // threadsApi.startNewThread (the store-level reset) always fires.
    expect(useThreadsMocks.startNewThread).toHaveBeenCalledTimes(1);
    // The config's startNewThread also fired: the active thread id changed
    // away from the explicitly-selected one and is no longer explicit.
    expect(wrapper.get("[data-testid='thread-id']").text()).not.toBe(
      "t-active",
    );
    expect(wrapper.get("[data-testid='has-explicit-thread-id']").text()).toBe(
      "false",
    );

    wrapper.unmount();
  });

  it("new-thread prefers onNewThread over the config's startNewThread when provided", async () => {
    const onNewThread = vi.fn();
    const wrapper = await mountDrawer({ onNewThread }, [h(ThreadIdProbe)]);

    // Seed an explicit active thread so a config-driven reset would be
    // observable if it (incorrectly) fired.
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
      new CustomEvent("new-thread", {
        detail: {},
        bubbles: true,
        composed: true,
      }),
    );
    await nextTick();

    expect(useThreadsMocks.startNewThread).toHaveBeenCalledTimes(1);
    expect(onNewThread).toHaveBeenCalledTimes(1);
    // Config-backed startNewThread was NOT used: the active thread the
    // provider tracks is unchanged (a config-driven reset would clear it).
    expect(wrapper.get("[data-testid='thread-id']").text()).toBe("t-active");

    wrapper.unmount();
  });

  it("routes retry(scope: fetch-more) to threadsApi.fetchMoreThreads", async () => {
    const wrapper = await mountDrawer();

    const el = wrapper.find(COPILOTKIT_THREADS_DRAWER_TAG).element;
    el.dispatchEvent(
      new CustomEvent("retry", {
        detail: { scope: "fetch-more" },
        bubbles: true,
        composed: true,
      }),
    );
    await nextTick();

    expect(useThreadsMocks.fetchMoreThreads).toHaveBeenCalledTimes(1);
    expect(useThreadsMocks.refetchThreads).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it("routes retry(scope: initial) to threadsApi.refetchThreads", async () => {
    const wrapper = await mountDrawer();

    const el = wrapper.find(COPILOTKIT_THREADS_DRAWER_TAG).element;
    el.dispatchEvent(
      new CustomEvent("retry", {
        detail: { scope: "initial" },
        bubbles: true,
        composed: true,
      }),
    );
    await nextTick();

    expect(useThreadsMocks.refetchThreads).toHaveBeenCalledTimes(1);
    expect(useThreadsMocks.fetchMoreThreads).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it("routes load-more to threadsApi.fetchMoreThreads", async () => {
    const wrapper = await mountDrawer();

    const el = wrapper.find(COPILOTKIT_THREADS_DRAWER_TAG).element;
    el.dispatchEvent(
      new CustomEvent("load-more", {
        detail: {},
        bubbles: true,
        composed: true,
      }),
    );
    await nextTick();

    expect(useThreadsMocks.fetchMoreThreads).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it("routes open-change to the config's setDrawerOpen under a surrounding provider", async () => {
    const wrapper = await mountDrawer({}, [h(DrawerOpenProbe)]);

    // The provider's drawerOpen always starts closed, regardless of
    // `isModalDefaultOpen` (that prop only seeds the chat modal).
    expect(wrapper.get("[data-testid='drawer-open']").text()).toBe("false");

    const el = wrapper.find(COPILOTKIT_THREADS_DRAWER_TAG).element;
    el.dispatchEvent(
      new CustomEvent("open-change", {
        detail: { open: true },
        bubbles: true,
        composed: true,
      }),
    );
    await nextTick();

    // The config-backed value flips — proving the event routed through
    // config.setDrawerOpen rather than only updating the element locally.
    expect(wrapper.get("[data-testid='drawer-open']").text()).toBe("true");

    el.dispatchEvent(
      new CustomEvent("open-change", {
        detail: { open: false },
        bubbles: true,
        composed: true,
      }),
    );
    await nextTick();

    expect(wrapper.get("[data-testid='drawer-open']").text()).toBe("false");

    wrapper.unmount();
  });

  it("resolved-unlicensed status ('none') shows the locked view and skips the thread fetch", async () => {
    licenseContextMock.value = {
      status: "none",
      license: null,
      checkFeature: () => true,
      getLimit: () => null,
    };

    const wrapper = await mountDrawer();

    const el = wrapper.find(COPILOTKIT_THREADS_DRAWER_TAG)
      .element as unknown as CopilotKitThreadsDrawerElement;

    expect(el.licensed).toBe(false);
    expect(
      toValue(
        useThreadsMocks.useThreadsInput?.enabled as MaybeRefOrGetter<boolean>,
      ),
    ).toBe(false);

    wrapper.unmount();
  });

  it("resolved-unlicensed status ('invalid') shows the locked view", async () => {
    licenseContextMock.value = {
      status: "invalid",
      license: null,
      checkFeature: () => false,
      getLimit: () => null,
    };

    const wrapper = await mountDrawer();

    const el = wrapper.find(COPILOTKIT_THREADS_DRAWER_TAG)
      .element as unknown as CopilotKitThreadsDrawerElement;

    expect(el.licensed).toBe(false);

    wrapper.unmount();
  });

  it("surfaces a genuine listError to the element's error string", async () => {
    const listError = new Error("boom");
    useThreadsMocks.listError.value = listError;
    useThreadsMocks.error.value = listError;

    const wrapper = await mountDrawer();

    const el = wrapper.find(COPILOTKIT_THREADS_DRAWER_TAG)
      .element as unknown as CopilotKitThreadsDrawerElement;

    expect(el.error).toBe(listError.message);

    wrapper.unmount();
  });

  it("forwards fetchMoreError to the element's fetchMoreError property without touching error", async () => {
    useThreadsMocks.fetchMoreError.value = new Error("couldn't load more");

    const wrapper = await mountDrawer();

    const el = wrapper.find(COPILOTKIT_THREADS_DRAWER_TAG)
      .element as unknown as CopilotKitThreadsDrawerElement;

    expect(el.fetchMoreError).toBe("couldn't load more");
    // The dedicated fetch-more channel must NOT bleed into the initial-list error.
    expect(el.error).toBeNull();

    wrapper.unmount();
  });

  it("suppresses a config/runtime error that is not a listError from the element's error string", async () => {
    // Only the combined `error` channel carries a dev/config error; `listError`
    // stays null because no genuine list-load failure occurred. The element
    // must not leak the developer-facing message into the end-user error UI.
    useThreadsMocks.error.value = new Error("Runtime URL is not configured");
    useThreadsMocks.listError.value = null;

    const wrapper = await mountDrawer();

    const el = wrapper.find(COPILOTKIT_THREADS_DRAWER_TAG)
      .element as unknown as CopilotKitThreadsDrawerElement;

    expect(el.error).toBeNull();

    wrapper.unmount();
  });

  it("forwards the limit prop to useThreads", async () => {
    const wrapper = await mountDrawer({ limit: 20 });

    expect(
      toValue(
        useThreadsMocks.useThreadsInput?.limit as MaybeRefOrGetter<number>,
      ),
    ).toBe(20);

    wrapper.unmount();
  });

  it("sets the element's licenseUrl when the prop is provided", async () => {
    const wrapper = await mountDrawer({
      licenseUrl: "https://example.com/upgrade",
    });

    const el = wrapper.find(COPILOTKIT_THREADS_DRAWER_TAG)
      .element as unknown as CopilotKitThreadsDrawerElement;

    expect(el.licenseUrl).toBe("https://example.com/upgrade");

    wrapper.unmount();
  });

  it("binds recent-label to the element", async () => {
    const wrapper = await mountDrawer({ recentLabel: "History" });

    const el = wrapper.find(COPILOTKIT_THREADS_DRAWER_TAG).element;
    expect(el.getAttribute("recent-label")).toBe("History");

    wrapper.unmount();
  });

  it("sets the element's collapsible property to false when collapsible is false", async () => {
    const wrapper = await mountDrawer({ collapsible: false });

    const el = wrapper.find(COPILOTKIT_THREADS_DRAWER_TAG)
      .element as unknown as {
      collapsible: boolean;
    };

    expect(el.collapsible).toBe(false);

    wrapper.unmount();
  });

  it("leaves the element collapsible (true) when the prop is omitted", async () => {
    // Regression: Vue coerces an omitted Boolean prop to `false`, so without the
    // wrapper's explicit `collapsible: true` withDefaults the element would be
    // forced to `false` and the collapse toggle would silently vanish.
    const wrapper = await mountDrawer({});

    const el = wrapper.find(COPILOTKIT_THREADS_DRAWER_TAG)
      .element as unknown as {
      collapsible: boolean;
    };

    expect(el.collapsible).toBe(true);

    wrapper.unmount();
  });

  it("re-emits the element's collapse-change event as collapse-change(collapsed)", async () => {
    const wrapper = await mountDrawer();

    const drawer = wrapper.findComponent(CopilotThreadsDrawer);
    const el = wrapper.find(COPILOTKIT_THREADS_DRAWER_TAG).element;
    el.dispatchEvent(
      new CustomEvent("collapse-change", {
        detail: { collapsed: true },
        bubbles: true,
        composed: true,
      }),
    );
    await nextTick();

    expect(drawer.emitted("collapse-change")?.[0]).toEqual([true]);

    wrapper.unmount();
  });

  it("leaves the element's default licenseUrl when the prop is omitted", async () => {
    const wrapper = await mountDrawer();

    const el = wrapper.find(COPILOTKIT_THREADS_DRAWER_TAG)
      .element as unknown as CopilotKitThreadsDrawerElement;

    expect(el.licenseUrl).toBe("https://docs.copilotkit.ai/intelligence");

    wrapper.unmount();
  });

  it('projects the row slot as a light-DOM child per thread with slot="row:<id>"', async () => {
    useThreadsMocks.threads.value = [
      makeThread("t-1"),
      makeThread("t-2"),
      makeThread("t-3"),
    ];

    // mountDrawer doesn't accept slots directly, so mount explicitly with
    // the `row` scoped slot wired through.
    const withRowSlot = mount(CopilotKitProvider, {
      props: { runtimeUrl: "/api/copilotkit" },
      slots: {
        default: () =>
          h(
            CopilotChatConfigurationProvider,
            { isModalDefaultOpen: true },
            {
              default: () =>
                h(
                  CopilotThreadsDrawer,
                  {},
                  {
                    row: ({ thread }: { thread: Thread }) =>
                      h("span", { class: "custom-row" }, `custom:${thread.id}`),
                  },
                ),
            },
          ),
      },
      attachTo: document.body,
    });
    await flushPromises();
    await nextTick();

    const el = withRowSlot.find(COPILOTKIT_THREADS_DRAWER_TAG).element;
    const projected = Array.from(
      el.querySelectorAll<HTMLElement>("[slot^='row:']"),
    );

    expect(projected).toHaveLength(3);
    const bySlot = new Map(
      projected.map((node) => [node.getAttribute("slot"), node]),
    );
    for (const t of ["t-1", "t-2", "t-3"]) {
      const node = bySlot.get(`row:${t}`);
      expect(node).toBeTruthy();
      expect(node?.querySelector(".custom-row")?.textContent).toBe(
        `custom:${t}`,
      );
    }

    withRowSlot.unmount();
  });

  it("returns focus to the chat input WITHIN the drawer's own chat-view container on a multi-chat page", async () => {
    // Two independent chat-view containers, each with its own input, to
    // prove `findChatInput` scopes to the drawer's ANCESTOR container rather
    // than grabbing whichever input is first in document order.
    const containerA = document.createElement("div");
    containerA.setAttribute("data-testid", "copilot-chat-view");
    const inputA = document.createElement("textarea");
    inputA.setAttribute("data-testid", "copilot-chat-input-textarea");
    containerA.appendChild(inputA);

    const containerB = document.createElement("div");
    containerB.setAttribute("data-testid", "copilot-chat-view");
    const inputB = document.createElement("textarea");
    inputB.setAttribute("data-testid", "copilot-chat-input-textarea");
    containerB.appendChild(inputB);

    document.body.appendChild(containerA);
    document.body.appendChild(containerB);

    // Mount the drawer directly into containerB, so the correct scoped
    // target is inputB, NOT inputA (which appears first in DOM order).
    const wrapper = mount(CopilotKitProvider, {
      props: { runtimeUrl: "/api/copilotkit" },
      slots: {
        default: () =>
          h(
            CopilotChatConfigurationProvider,
            { isModalDefaultOpen: true },
            {
              default: () => h(CopilotThreadsDrawer, {}),
            },
          ),
      },
      attachTo: containerB,
    });
    await flushPromises();
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

    expect(document.activeElement).toBe(inputB);
    expect(document.activeElement).not.toBe(inputA);

    wrapper.unmount();
    containerA.remove();
    containerB.remove();
  });
});

describe("CopilotThreadsDrawer package export", () => {
  it("is exported from the package entry", () => {
    expect((vue as Record<string, unknown>).CopilotThreadsDrawer).toBeDefined();
  });
});
