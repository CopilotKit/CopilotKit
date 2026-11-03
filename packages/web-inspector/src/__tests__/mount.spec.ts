import { afterEach, describe, expect, it, vi } from "vitest";
import type { CopilotKitCore } from "@copilotkit/core";
import { ɵmountInspector } from "../mount";
import type { ɵWebInspectorModule } from "../mount";
import type { WebInspectorElement } from "../index";

const TAG = "cpk-mount-test-inspector";

class FakeInspector extends HTMLElement {
  core: unknown = null;
  autoAttachCore = true;
  coreAtConnection: unknown = undefined;
  openInspector = vi.fn();

  connectedCallback() {
    this.coreAtConnection = this.core;
  }

  reportVisibility(visible: boolean) {
    this.dispatchEvent(
      new CustomEvent("cpk-inspector-visibility-change", {
        detail: { visible },
      }),
    );
  }
}

const fakeModule: ɵWebInspectorModule = {
  WEB_INSPECTOR_TAG: TAG,
  defineWebInspector: () => {
    if (!customElements.get(TAG)) customElements.define(TAG, FakeInspector);
  },
  configureWebInspectorElement: (inspector, core) => {
    inspector.autoAttachCore = false;
    inspector.core = core;
    return inspector;
  },
};

// Opaque stand-ins: the mount only passes the core through.
const coreA = { id: "a" } as unknown as CopilotKitCore;
const coreB = { id: "b" } as unknown as CopilotKitCore;

function createHost() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return host;
}

function mount(host: Element, core: CopilotKitCore | null = coreA) {
  return ɵmountInspector(host, core, {
    load: () => Promise.resolve(fakeModule),
    notificationContext: { development: true, framework: "react" },
  });
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

function inspectors() {
  return [...document.querySelectorAll<FakeInspector>(TAG)];
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ɵmountInspector", () => {
  it("connects the element inside the host with the core already attached", async () => {
    const host = createHost();
    mount(host);
    expect(inspectors()).toHaveLength(0);

    await settle();

    const [inspector] = inspectors();
    expect(inspector?.parentElement).toBe(host);
    expect(inspector?.coreAtConnection).toBe(coreA);
    expect(inspector?.autoAttachCore).toBe(false);
  });

  it("opens the latest request made before the element loaded", async () => {
    const handle = mount(createHost());
    handle.open({ messageId: "m-1" });
    handle.open({ messageId: "m-2", threadId: "t-2" });

    await settle();

    const [inspector] = inspectors();
    expect(inspector?.openInspector).toHaveBeenCalledExactlyOnceWith(
      "message_toolbar",
      { messageId: "m-2", threadId: "t-2" },
    );
  });

  it("opens directly once the element is mounted", async () => {
    const handle = mount(createHost());
    await settle();

    handle.open({ messageId: "m-3" });

    expect(inspectors()[0]?.openInspector).toHaveBeenCalledExactlyOnceWith(
      "message_toolbar",
      { messageId: "m-3" },
    );
  });

  it("uses the latest core, whether it changes before or after loading", async () => {
    const handle = mount(createHost());
    handle.setCore(coreB);
    await settle();
    expect(inspectors()[0]?.coreAtConnection).toBe(coreB);

    handle.setCore(null);
    expect(inspectors()[0]?.core).toBeNull();
  });

  it("reports visibility changes, and hidden when disposed while visible", async () => {
    const handle = mount(createHost());
    const seen: boolean[] = [];
    handle.onVisibility((visible) => seen.push(visible));
    await settle();

    const [inspector] = inspectors();
    inspector?.reportVisibility(true);
    inspector?.reportVisibility(true);
    handle.dispose();

    expect(seen).toEqual([true, false]);
  });

  it("removes the element it created on dispose", async () => {
    const handle = mount(createHost());
    await settle();
    expect(inspectors()).toHaveLength(1);

    handle.dispose();

    expect(inspectors()).toHaveLength(0);
    expect(handle.element).toBeNull();
  });

  it("mounts nothing when disposed before the module loads", async () => {
    const handle = mount(createHost());
    handle.open({ messageId: "m-4" });
    handle.dispose();

    await settle();

    expect(inspectors()).toHaveLength(0);
  });

  it("adopts an Inspector the page already has and leaves it in place on dispose", async () => {
    fakeModule.defineWebInspector();
    const existing = document.createElement(TAG) as FakeInspector;
    document.body.appendChild(existing);

    const handle = mount(createHost());
    await settle();

    expect(inspectors()).toEqual([existing]);
    expect(existing.core).toBe(coreA);

    handle.dispose();
    expect(existing.isConnected).toBe(true);
  });

  it("gives each mount its own element instead of adopting another mount's", async () => {
    const first = mount(createHost(), coreA);
    await settle();
    const second = mount(createHost(), coreB);
    await settle();

    const [firstElement, secondElement] = inspectors();
    expect(firstElement?.core).toBe(coreA);
    expect(secondElement?.core).toBe(coreB);

    second.dispose();
    expect(inspectors()).toEqual([firstElement]);
    first.dispose();
  });

  it("calls element listeners with the mounted element", async () => {
    const handle = mount(createHost());
    const mounted: WebInspectorElement[] = [];
    handle.onElement((element) => mounted.push(element));

    await settle();

    expect(mounted).toEqual(inspectors());
  });

  it("logs a load failure instead of throwing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("chunk failed");
    ɵmountInspector(createHost(), coreA, {
      load: () => Promise.reject(failure),
      notificationContext: { development: true },
    });

    await settle();

    expect(error).toHaveBeenCalledWith(
      "Failed to load CopilotKit inspector:",
      failure,
    );
  });
});
