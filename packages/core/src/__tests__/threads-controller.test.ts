import { describe, expect, it, vi } from "vitest";
import { CopilotKitCoreRuntimeConnectionStatus } from "../core/core";
import { ɵcreateThreadStore } from "../threads";
import type { ɵThread } from "../threads";
import { ɵThreadsController, ɵprojectThread } from "../threads-controller";
import type { ɵThreadsCore, ɵThreadsInput } from "../threads-controller";
import type { ɵRuntimeInfo } from "../core/runtime-info";

function endpoints(
  overrides: { list?: boolean; inspect?: boolean; mutations?: boolean } = {},
) {
  return {
    list: true,
    inspect: true,
    mutations: true,
    realtimeMetadata: true,
    ...overrides,
  };
}

type CoreOverrides = Partial<Omit<ɵThreadsCore, "ɵruntimeInfo">> &
  Partial<Pick<ɵRuntimeInfo, "status" | "threadEndpoints" | "intelligence">>;

function createCore({
  status = CopilotKitCoreRuntimeConnectionStatus.Connected,
  threadEndpoints = endpoints(),
  intelligence,
  ...overrides
}: CoreOverrides = {}): ɵThreadsCore {
  return {
    runtimeUrl: "https://runtime.local/api",
    ɵruntimeInfo: {
      status,
      a2uiEnabled: false,
      a2uiAgents: undefined,
      openGenerativeUIEnabled: false,
      licenseStatus: undefined,
      runtimeEntitlements: undefined,
      runtimeEntitlementRetryPending: false,
      threadEndpoints,
      intelligence,
      audioFileTranscriptionEnabled: false,
    },
    ɵheadersGeneration: 0,
    registerThreadStore: vi.fn(),
    unregisterThreadStore: vi.fn(),
    ...overrides,
  };
}

/** A started controller over a real store whose fetch never settles. */
function createController(input: Partial<ɵThreadsInput> = {}) {
  const store = ɵcreateThreadStore({
    fetch: vi.fn(() => new Promise<Response>(() => {})),
  });
  const setContext = vi.spyOn(store, "setContext");
  const fullInput: ɵThreadsInput = {
    core: createCore(),
    agentId: "agent-1",
    enabled: true,
    ...input,
  };
  const controller = new ɵThreadsController(store, fullInput);
  const stop = controller.start();
  return { controller, store, setContext, input: fullInput, stop };
}

describe("ɵprojectThread", () => {
  it("drops internal fields and an absent lastRunAt", () => {
    const thread: ɵThread = {
      id: "t1",
      organizationId: "org",
      agentId: "a",
      createdById: "user",
      name: null,
      archived: false,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-02",
    };

    expect(ɵprojectThread(thread)).toEqual({
      id: "t1",
      agentId: "a",
      name: null,
      archived: false,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-02",
    });
    expect(ɵprojectThread({ ...thread, lastRunAt: "x" }).lastRunAt).toBe("x");
  });
});

describe("ɵThreadsController context", () => {
  it("waits for the runtime connection and shows loading meanwhile", () => {
    const core = createCore({
      status: CopilotKitCoreRuntimeConnectionStatus.Connecting,
    });
    const { controller, setContext, input } = createController({ core });

    controller.update(input);

    expect(setContext).not.toHaveBeenCalled();
    expect(controller.getSnapshot().isLoading).toBe(true);
  });

  it("sends an unchanged context once", () => {
    const { controller, setContext, input } = createController();

    controller.update(input);
    controller.update({ ...input });

    expect(setContext).toHaveBeenCalledTimes(1);
    expect(setContext).toHaveBeenCalledWith({
      runtimeUrl: "https://runtime.local/api",
      wsUrl: undefined,
      agentId: "agent-1",
      includeArchived: undefined,
      limit: undefined,
    });
  });

  it("sends the context again after a header source change", () => {
    const { controller, setContext, input } = createController();
    controller.update(input);

    controller.update({
      ...input,
      core: { ...input.core, ɵheadersGeneration: 1 },
    });

    expect(setContext).toHaveBeenCalledTimes(2);
  });

  it("does not clear a context it never sent", () => {
    const { controller, setContext, input } = createController({
      enabled: false,
    });

    controller.update(input);

    expect(setContext).not.toHaveBeenCalled();
    expect(controller.getSnapshot().isLoading).toBe(false);
  });

  it("clears a sent context when disabled", () => {
    const { controller, setContext, input } = createController();
    controller.update(input);

    controller.update({ ...input, enabled: false });

    expect(setContext).toHaveBeenLastCalledWith(null);
  });
});

describe("ɵThreadsController errors", () => {
  it("reports a missing runtime URL until a new thread dismisses it", () => {
    const core = createCore({ runtimeUrl: undefined });
    const { controller, input } = createController({ core });
    controller.update(input);

    expect(controller.getSnapshot()).toMatchObject({
      error: new Error("Runtime URL is not configured"),
      listError: null,
      isLoading: false,
    });

    controller.startNewThread();

    expect(controller.getSnapshot().error).toBeNull();
  });

  it("reports thread endpoints the runtime does not support", () => {
    const core = createCore({
      threadEndpoints: endpoints({ list: false, inspect: false }),
    });
    const { controller, setContext, input } = createController({ core });
    controller.update(input);

    expect(controller.getSnapshot()).toMatchObject({
      error: new Error(
        "Thread endpoints are not available on this CopilotKit runtime",
      ),
      listError: null,
      isLoading: false,
    });
    expect(setContext).not.toHaveBeenCalled();
  });

  it("reports a list the runtime refuses without a caller identity", () => {
    // A runtime without identifyUser serves a thread by id but not the list.
    const core = createCore({
      threadEndpoints: endpoints({ list: false, mutations: false }),
    });
    const { controller, setContext, input } = createController({ core });
    controller.update(input);

    const identityError = new Error(
      "Listing threads needs a caller identity. Set identifyUser on CopilotRuntime.",
    );
    expect(controller.getSnapshot()).toMatchObject({
      error: identityError,
      listError: identityError,
      isLoading: false,
    });
    expect(setContext).not.toHaveBeenCalled();
  });

  it("drops the identity error once the runtime lists threads", () => {
    const core = createCore({
      threadEndpoints: endpoints({ list: false, mutations: false }),
    });
    const { controller, input } = createController({ core });
    controller.update(input);

    controller.update({ ...input, core: createCore() });

    expect(controller.getSnapshot()).toMatchObject({
      error: null,
      listError: null,
      isLoading: true,
    });
  });

  it("rejects mutations the runtime does not support", async () => {
    const core = createCore({
      threadEndpoints: endpoints({ mutations: false }),
    });
    const { controller, input } = createController({ core });
    controller.update(input);

    await expect(controller.renameThread("t1", "New")).rejects.toThrow(
      "Thread mutations are not available on this CopilotKit runtime",
    );
  });
});

describe("ɵThreadsController registry", () => {
  it("claims the store per agent while enabled and releases it", () => {
    const { controller, store, input, stop } = createController();
    const { core } = input;

    controller.update(input);
    controller.update({ ...input, agentId: "agent-2" });
    controller.update({ ...input, agentId: "agent-2", enabled: false });
    stop();

    expect(vi.mocked(core.registerThreadStore).mock.calls).toEqual([
      ["agent-1", store],
      ["agent-2", store],
    ]);
    expect(vi.mocked(core.unregisterThreadStore).mock.calls).toEqual([
      ["agent-1"],
      ["agent-2"],
    ]);
  });
});
