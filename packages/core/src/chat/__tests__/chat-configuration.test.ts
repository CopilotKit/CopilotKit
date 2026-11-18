import { afterEach, describe, expect, it, vi } from "vitest";
import { ɵChatConfigurationStore } from "../chat-configuration";
import type { ɵChatConfigurationOptions } from "../chat-configuration";

const stores: ɵChatConfigurationStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A store with a subscriber, like a mounted provider. */
function mount(
  options: ɵChatConfigurationOptions = {},
  parent: ɵChatConfigurationStore | null = null,
) {
  const store = new ɵChatConfigurationStore(options, parent);
  store.subscribe(() => {});
  stores.push(store);
  return store;
}

function useMobileViewport() {
  vi.stubGlobal("window", {
    matchMedia: (query: string) => ({ matches: query.includes("max-width") }),
  });
}

function silenceWarnings() {
  return vi.spyOn(console, "warn").mockImplementation(() => {});
}

describe("ɵChatConfigurationStore agent", () => {
  it("uses own id, then parent, then provider default, then default", () => {
    const root = mount({ providerAgentId: "provider" });
    expect(root.getSnapshot().agentId).toBe("provider");
    expect(mount({ agentId: "own" }, root).getSnapshot().agentId).toBe("own");
    const named = mount({ agentId: "named" });
    expect(mount({}, named).getSnapshot().agentId).toBe("named");
    expect(mount().getSnapshot().agentId).toBe("default");
  });
});

describe("ɵChatConfigurationStore thread", () => {
  it("mints one placeholder thread and keeps it across prop updates", () => {
    const store = mount();
    const first = store.getSnapshot();

    store.update({ agentId: "other" });

    expect(store.getSnapshot().threadId).toBe(first.threadId);
    expect(first.hasExplicitThreadId).toBe(false);
  });

  it("shows a controlled thread and ignores imperative changes with a warning", () => {
    const warn = silenceWarnings();
    const store = mount({ threadId: "pinned" });

    store.setActiveThreadId("other");
    store.startNewThread();

    expect(store.getSnapshot()).toMatchObject({
      threadId: "pinned",
      hasExplicitThreadId: true,
    });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("lets a picked thread replace a non-explicit seed", () => {
    const store = mount({ threadId: "seed", hasExplicitThreadId: false });
    expect(store.getSnapshot()).toMatchObject({
      threadId: "seed",
      hasExplicitThreadId: false,
    });

    store.setActiveThreadId("picked");

    expect(store.getSnapshot()).toMatchObject({
      threadId: "picked",
      hasExplicitThreadId: true,
    });
  });

  it("starts a new non-explicit thread", () => {
    const store = mount();
    store.setActiveThreadId("picked");

    store.startNewThread();

    const { threadId, hasExplicitThreadId } = store.getSnapshot();
    expect(threadId).not.toBe("picked");
    expect(hasExplicitThreadId).toBe(false);
  });

  it("sends a nested provider's thread change to the top-most store", () => {
    const root = mount();
    const child = mount({}, root);

    child.setActiveThreadId("picked");

    expect(root.getSnapshot().threadId).toBe("picked");
    expect(child.getSnapshot().threadId).toBe("picked");
  });

  it("warns at a controlled nested provider under an uncontrolled root", () => {
    const warn = silenceWarnings();
    const root = mount();
    const child = mount({ threadId: "pinned" }, root);

    child.setActiveThreadId("other");

    expect(warn).toHaveBeenCalledOnce();
    expect(root.getSnapshot().threadId).not.toBe("other");
  });

  it("notifies only when a value changes", () => {
    const store = mount();
    const listener = vi.fn();
    store.subscribe(listener);

    store.update({});
    store.setActiveThreadId("picked");
    store.setActiveThreadId("picked");

    expect(listener).toHaveBeenCalledOnce();
  });
});

describe("ɵChatConfigurationStore drawer", () => {
  it("is registered while any drawer is mounted, and each cleanup runs once", () => {
    const store = mount();
    const first = store.registerDrawer();
    const second = store.registerDrawer();

    first();
    first();
    expect(store.getSnapshot().drawerRegistered).toBe(true);

    second();
    expect(store.getSnapshot().drawerRegistered).toBe(false);
  });

  it("shares one drawer across nested providers", () => {
    const root = mount();
    const child = mount({}, root);

    child.registerDrawer();
    child.setDrawerOpen(true);

    expect(root.getSnapshot()).toMatchObject({
      drawerRegistered: true,
      drawerOpen: true,
    });
  });
});

describe("ɵChatConfigurationStore modal", () => {
  it("starts open unless the provider sets a default", () => {
    expect(mount().getSnapshot().isModalOpen).toBe(true);
    expect(mount({ isModalDefaultOpen: false }).getSnapshot().isModalOpen).toBe(
      false,
    );
  });

  it("shares the parent's modal when it has no default of its own", () => {
    const root = mount({ isModalDefaultOpen: false });
    const child = mount({}, root);

    child.setModalOpen(true);

    expect(root.getSnapshot().isModalOpen).toBe(true);
    expect(child.getSnapshot().isModalOpen).toBe(true);
  });

  it("reports an owned modal's changes upward and follows later parent changes", () => {
    const root = mount();
    const child = mount({ isModalDefaultOpen: false }, root);
    expect(child.getSnapshot().isModalOpen).toBe(false);

    child.setModalOpen(true);
    root.setModalOpen(false);

    expect(child.getSnapshot().isModalOpen).toBe(false);
    root.setModalOpen(true);
    expect(child.getSnapshot().isModalOpen).toBe(true);
  });

  it("closes the drawer when the modal opens on mobile", () => {
    useMobileViewport();
    const store = mount({ isModalDefaultOpen: false });
    store.setDrawerOpen(true);

    store.setModalOpen(true);

    expect(store.getSnapshot()).toMatchObject({
      isModalOpen: true,
      drawerOpen: false,
    });
  });

  it("closes the rendered modal when the drawer opens on mobile", () => {
    useMobileViewport();
    const root = mount();
    const rendered = mount({ isModalDefaultOpen: true }, root);

    root.setDrawerOpen(true);

    expect(rendered.getSnapshot().isModalOpen).toBe(false);
  });

  it("keeps both open on desktop", () => {
    const store = mount();
    store.setDrawerOpen(true);

    expect(store.getSnapshot()).toMatchObject({
      isModalOpen: true,
      drawerOpen: true,
    });
  });
});

describe("ɵChatConfigurationStore.bindOpenThread", () => {
  it("registers the shown thread, follows changes, and unregisters", () => {
    const events: string[] = [];
    const registry = {
      registerOpenThread: ({
        agentId,
        threadId,
      }: {
        agentId: string;
        threadId: string;
      }) => {
        events.push(`open ${agentId} ${threadId}`);
        return {
          update: (next: string) => events.push(`update ${next}`),
          unregister: () => events.push(`close ${agentId}`),
        };
      },
    };
    const store = mount({ agentId: "a", threadId: "t1" });

    const unbind = store.bindOpenThread(registry);
    store.update({ agentId: "a", threadId: "t2" });
    store.update({ agentId: "b", threadId: "t2" });
    unbind();

    expect(events).toEqual([
      "open a t1",
      "update t2",
      "close a",
      "open b t2",
      "close b",
    ]);
  });
});
