import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
  emitInspectorViewThreadResult,
  onInspectorStopViewing,
  onInspectorViewThread,
  ɵcreateThreadStore,
  ɵselectThreadsIsLoading,
} from "@copilotkit/core";
import type { ɵThread, ɵThreadStore } from "@copilotkit/core";
import type { ThreadEndpointRuntimeInfo } from "@copilotkit/shared";
import { afterEach, expect, test, vi } from "vitest";

import { CpkThreadInspector, WebInspectorElement } from "../index.js";

const RUNTIME_URL = "https://runtime.example.test";
const ENABLED_ENDPOINTS = {
  list: true,
  inspect: true,
  mutations: false,
  realtimeMetadata: false,
} satisfies ThreadEndpointRuntimeInfo;

const SAVED_THREAD: ɵThread = {
  id: "saved-thread",
  organizationId: "organization-1",
  agentId: "default",
  createdById: "user-1",
  name: "Saved chat",
  archived: false,
  createdAt: "2026-08-03T10:00:00.000Z",
  updatedAt: "2026-08-04T10:00:00.000Z",
};

function viewButton(root: ParentNode | null): HTMLButtonElement | null {
  return (
    root?.querySelector<HTMLButtonElement>(
      '[data-testid="cpk-inspector-view-in-app"]',
    ) ?? null
  );
}

test("thread details hide the action until the parent asks for it", async () => {
  const detail = new CpkThreadInspector();
  detail.threadId = "saved-thread";
  detail.thread = SAVED_THREAD;
  document.body.append(detail);
  await detail.updateComplete;
  expect(viewButton(detail.shadowRoot)).toBeNull();

  detail.viewInAppMode = "view";
  await detail.updateComplete;
  expect(viewButton(detail.shadowRoot)?.textContent?.trim()).toBe(
    "View in your app",
  );

  detail.viewInAppMode = "stop";
  await detail.updateComplete;
  expect(viewButton(detail.shadowRoot)?.textContent?.trim()).toBe(
    "Stop viewing",
  );
  detail.remove();
});

class ViewInAppTestCore extends CopilotKitCore {
  constructor() {
    super({
      runtimeUrl: RUNTIME_URL,
      runtimeTransport: "rest",
      deferInitialConnection: true,
    });
  }

  override get threadEndpoints(): ThreadEndpointRuntimeInfo {
    return ENABLED_ENDPOINTS;
  }

  override get telemetryDisabled(): boolean {
    return true;
  }

  async emitConnected(): Promise<void> {
    await this.notifySubscribers(
      (subscriber) =>
        subscriber.onRuntimeConnectionStatusChanged?.({
          copilotkit: this,
          status: CopilotKitCoreRuntimeConnectionStatus.Connected,
        }),
      "view-in-app test runtime subscriber failed",
    );
  }
}

async function flushInspector(inspector: WebInspectorElement): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve();
    await inspector.updateComplete;
    const detail = inspector.shadowRoot?.querySelector("cpk-thread-details");
    if (detail) await (detail as CpkThreadInspector).updateComplete;
  }
}

async function setupInspector(): Promise<{
  inspector: WebInspectorElement;
  store: ɵThreadStore;
  core: ViewInAppTestCore;
  teardown: () => Promise<void>;
}> {
  document.body.replaceChildren();
  window.localStorage.clear();
  const core = new ViewInAppTestCore();
  const store = ɵcreateThreadStore({
    fetch: async () =>
      new Response(JSON.stringify({ threads: [SAVED_THREAD] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  store.start();
  store.setContext({
    runtimeUrl: RUNTIME_URL,
    headers: {},
    agentId: "default",
  });
  core.registerThreadStore("default", store);
  await vi.waitFor(() => {
    expect(ɵselectThreadsIsLoading(store.getState())).toBe(false);
  });
  const inspector = new WebInspectorElement();
  document.body.append(inspector);
  inspector.core = core;
  await core.emitConnected();
  await flushInspector(inspector);
  const openButton = inspector.shadowRoot?.querySelector<HTMLButtonElement>(
    'button[aria-label="Web Inspector"]',
  );
  openButton?.click();
  await flushInspector(inspector);
  return {
    inspector,
    store,
    core,
    teardown: async () => {
      store.stop();
      inspector.remove();
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

test("a real thread shows View in your app and example threads do not", async () => {
  const { inspector, teardown } = await setupInspector();
  const detail = inspector.shadowRoot?.querySelector("cpk-thread-details");
  expect(viewButton(detail?.shadowRoot ?? null)?.textContent?.trim()).toBe(
    "View in your app",
  );
  await teardown();
});

test("clicking view-in-app without a chat shows a no-matching-chat error", async () => {
  const { inspector, teardown } = await setupInspector();
  const detail = inspector.shadowRoot?.querySelector(
    "cpk-thread-details",
  ) as CpkThreadInspector;
  viewButton(detail.shadowRoot)?.click();
  await vi.waitFor(() => {
    expect(
      detail.shadowRoot?.querySelector("[role='alert']")?.textContent,
    ).toMatch(/No official chat/);
  });
  await teardown();
});

test("a successful view-thread-result turns the button into Stop viewing", async () => {
  const received: Array<{ threadId: string; agentId: string }> = [];
  const unsubscribe = onInspectorViewThread((payload) => {
    received.push(payload);
    emitInspectorViewThreadResult({
      threadId: payload.threadId,
      agentId: payload.agentId,
      ok: true,
    });
  });
  const { inspector, teardown } = await setupInspector();
  const detail = inspector.shadowRoot?.querySelector(
    "cpk-thread-details",
  ) as CpkThreadInspector;
  viewButton(detail.shadowRoot)?.click();
  await flushInspector(inspector);
  expect(received).toEqual([{ threadId: "saved-thread", agentId: "default" }]);
  expect(viewButton(detail.shadowRoot)?.textContent?.trim()).toBe(
    "Stop viewing",
  );
  const list = inspector.shadowRoot?.querySelector("cpk-thread-list");
  expect(list?.shadowRoot?.textContent).toContain("In app");
  unsubscribe();
  await teardown();
});

test("Stop viewing emits stop-viewing", async () => {
  const stops: Array<{ agentId: string }> = [];
  const offView = onInspectorViewThread((payload) => {
    emitInspectorViewThreadResult({
      threadId: payload.threadId,
      agentId: payload.agentId,
      ok: true,
    });
  });
  const offStop = onInspectorStopViewing((payload) => {
    stops.push(payload);
  });
  const { inspector, teardown } = await setupInspector();
  const detail = inspector.shadowRoot?.querySelector(
    "cpk-thread-details",
  ) as CpkThreadInspector;
  viewButton(detail.shadowRoot)?.click();
  await flushInspector(inspector);
  viewButton(detail.shadowRoot)?.click();
  expect(stops).toEqual([{ agentId: "default" }]);
  offView();
  offStop();
  await teardown();
});
