import { HttpAgent } from "@ag-ui/client";
import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
  ɵcreateThreadStore,
  ɵselectThreads,
  ɵselectThreadsIsLoading,
} from "@copilotkit/core";
import type { ɵThread, ɵThreadStore } from "@copilotkit/core";
import { expect, test, vi } from "vitest";

import { WebInspectorElement } from "../index.js";
import type { ɵCpkThreadDetails } from "../index.js";

const RUNTIME_URL = "https://runtime.example.test";

type AgentId = "alpha" | "beta";

type LoggedRequest = Readonly<{
  url: string;
  method: string;
}>;

type SetupOptions = Readonly<{
  alphaThreads: readonly ɵThread[];
  betaThreads: readonly ɵThread[];
}>;

type ThreadSelectionHarness = Readonly<{
  core: CopilotKitCore;
  inspector: WebInspectorElement;
  stores: Readonly<Record<AgentId, ɵThreadStore>>;
  requests: () => readonly LoggedRequest[];
  detailRequestIds: () => string[];
  details: () => ɵCpkThreadDetails | null;
  rowNames: () => string[];
  activeRowNames: () => string[];
  clickThread: (name: string) => Promise<void>;
  selectContext: (agentId: AgentId) => Promise<void>;
  refresh: (agentId: AgentId, threads: readonly ɵThread[]) => Promise<void>;
  teardown: () => Promise<void>;
}>;

function thread(
  id: string,
  agentId: AgentId,
  name: string,
  updatedAt: string,
  createdAt = "2026-08-03T10:00:00.000Z",
): ɵThread {
  return {
    id,
    organizationId: "organization-1",
    agentId,
    createdById: "user-1",
    name,
    archived: false,
    createdAt,
    updatedAt,
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: RequestInfo | URL): URL {
  return input instanceof Request
    ? new URL(input.url)
    : new URL(String(input), window.location.href);
}

function requestMethod(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): string {
  return init?.method ?? (input instanceof Request ? input.method : "GET");
}

function detailRequestId(url: string): string | null {
  const match = new URL(url).pathname.match(
    /\/threads\/([^/]+)\/(events|messages|state)$/,
  );
  const encodedId = match?.[1];
  return encodedId ? decodeURIComponent(encodedId) : null;
}

function rowSignature(rows: readonly ɵThread[]): string[] {
  return rows
    .map((row) => `${row.id}:${row.updatedAt}:${row.createdAt}`)
    .sort();
}

async function flushInspector(inspector: WebInspectorElement): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await inspector.updateComplete;
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  await inspector.updateComplete;
}

async function setup(options: SetupOptions): Promise<ThreadSelectionHarness> {
  document.body.replaceChildren();
  window.localStorage.clear();
  window.sessionStorage.clear();

  const requests: LoggedRequest[] = [];
  const rowsByAgent: Record<AgentId, ɵThread[]> = {
    alpha: options.alphaThreads.map((row) => ({ ...row })),
    beta: options.betaThreads.map((row) => ({ ...row })),
  };
  const fetchMock = Object.assign(
    vi.fn(
      async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        const url = requestUrl(input);
        requests.push({
          url: url.href,
          method: requestMethod(input, init),
        });

        if (url.href === "https://cdn.copilotkit.ai/announcements.json") {
          return new Response(null, { status: 404 });
        }
        if (url.pathname.endsWith("/info")) {
          return jsonResponse({
            version: "1.0.0",
            agents: {},
            audioFileTranscriptionEnabled: false,
            mode: "sse",
            threadEndpoints: {
              list: true,
              inspect: true,
              mutations: false,
              realtimeMetadata: false,
            },
            inspectorMetadata: false,
            telemetryDisabled: true,
          });
        }
        if (url.pathname.endsWith("/threads")) {
          const agentId = url.searchParams.get("agentId");
          if (agentId !== "alpha" && agentId !== "beta") {
            throw new Error(`Unexpected thread-list agent: ${agentId}`);
          }
          return jsonResponse({
            threads: rowsByAgent[agentId].map((row) => ({ ...row })),
            joinCode: null,
          });
        }

        const requestedThreadId = detailRequestId(url.href);
        if (requestedThreadId !== null && url.pathname.endsWith("/events")) {
          return jsonResponse({
            events: [
              {
                type: "RUN_STARTED",
                timestamp: "2026-08-03T12:00:00.000Z",
                payload: { threadId: requestedThreadId },
              },
            ],
          });
        }
        if (requestedThreadId !== null && url.pathname.endsWith("/messages")) {
          return jsonResponse({ messages: [] });
        }
        if (requestedThreadId !== null && url.pathname.endsWith("/state")) {
          return jsonResponse({ state: {} });
        }

        throw new Error(`Unexpected Inspector request: ${url.href}`);
      },
    ),
    globalThis.fetch,
  );
  vi.stubGlobal("fetch", fetchMock);

  const alphaAgent = new HttpAgent({ url: `${RUNTIME_URL}/agents/alpha` });
  const betaAgent = new HttpAgent({ url: `${RUNTIME_URL}/agents/beta` });
  const core = new CopilotKitCore({
    runtimeUrl: RUNTIME_URL,
    runtimeTransport: "rest",
    deferInitialConnection: true,
    agents__unsafe_dev_only: {
      alpha: alphaAgent,
      beta: betaAgent,
    },
  });

  const alphaStore = ɵcreateThreadStore({ fetch: fetchMock });
  alphaStore.start();
  alphaStore.setContext({
    runtimeUrl: RUNTIME_URL,
    headers: {},
    agentId: "alpha",
  });
  core.registerThreadStore("alpha", alphaStore);

  const betaStore = ɵcreateThreadStore({ fetch: fetchMock });
  betaStore.start();
  betaStore.setContext({
    runtimeUrl: RUNTIME_URL,
    headers: {},
    agentId: "beta",
  });
  core.registerThreadStore("beta", betaStore);

  const stores = { alpha: alphaStore, beta: betaStore };
  await vi.waitFor(() => {
    expect(ɵselectThreadsIsLoading(alphaStore.getState())).toBe(false);
    expect(ɵselectThreadsIsLoading(betaStore.getState())).toBe(false);
    expect(rowSignature(ɵselectThreads(alphaStore.getState()))).toEqual(
      rowSignature(options.alphaThreads),
    );
    expect(rowSignature(ɵselectThreads(betaStore.getState()))).toEqual(
      rowSignature(options.betaThreads),
    );
  });

  const inspector = new WebInspectorElement();
  inspector.core = core;
  document.body.append(inspector);
  core.connect();

  await vi.waitFor(() => {
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    expect(core.threadEndpoints?.list).toBe(true);
  });
  await flushInspector(inspector);

  const openButton = inspector.shadowRoot?.querySelector<HTMLButtonElement>(
    'button[aria-label="Web Inspector"]',
  );
  if (!openButton) throw new Error("Web Inspector open button not found");
  openButton.click();
  await flushInspector(inspector);

  const threadsButton = Array.from(
    inspector.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ?? [],
  ).find((button) => button.textContent?.trim() === "Threads");
  if (!threadsButton) throw new Error("Threads menu button not found");
  threadsButton.click();
  await flushInspector(inspector);

  const details = () =>
    inspector.shadowRoot?.querySelector<ɵCpkThreadDetails>(
      "cpk-thread-details",
    ) ?? null;

  const listRows = () =>
    Array.from(
      inspector.shadowRoot
        ?.querySelector<HTMLElement>("cpk-thread-list")
        ?.shadowRoot?.querySelectorAll<HTMLElement>(".cpk-tl__item") ?? [],
    );

  return {
    core,
    inspector,
    stores,
    requests: () => [...requests],
    detailRequestIds: () =>
      requests
        .map((request) => detailRequestId(request.url))
        .filter((id): id is string => id !== null),
    details,
    rowNames: () =>
      listRows().map(
        (row) =>
          row
            .querySelector<HTMLElement>(".cpk-tl__name")
            ?.textContent?.trim() ?? "",
      ),
    activeRowNames: () =>
      listRows()
        .filter((row) => row.classList.contains("cpk-tl__item--active"))
        .map(
          (row) =>
            row
              .querySelector<HTMLElement>(".cpk-tl__name")
              ?.textContent?.trim() ?? "",
        ),
    async clickThread(name) {
      const row = listRows().find((candidate) =>
        candidate.textContent?.includes(name),
      );
      if (!row) throw new Error(`Thread row not found: ${name}`);
      row.click();
      await flushInspector(inspector);
    },
    async selectContext(agentId) {
      const trigger = Array.from(
        inspector.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ??
          [],
      ).find((button) => button.textContent?.trim() === "All Agents");
      if (!trigger) throw new Error("All Agents context control not found");
      trigger.dispatchEvent(
        new Event("pointerdown", { bubbles: true, cancelable: true }),
      );
      await flushInspector(inspector);

      const option = Array.from(
        inspector.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ??
          [],
      ).find((button) => button.textContent?.trim() === agentId);
      if (!option) throw new Error(`Context option not found: ${agentId}`);
      option.click();
      await flushInspector(inspector);
    },
    async refresh(agentId, threads) {
      rowsByAgent[agentId] = threads.map((row) => ({ ...row }));
      stores[agentId].refresh();
      await vi.waitFor(() => {
        expect(ɵselectThreadsIsLoading(stores[agentId].getState())).toBe(false);
        expect(
          rowSignature(ɵselectThreads(stores[agentId].getState())),
        ).toEqual(rowSignature(threads));
      });
      await flushInspector(inspector);
    },
    async teardown() {
      alphaStore.stop();
      betaStore.stop();
      core.unregisterThreadStore("alpha");
      core.unregisterThreadStore("beta");
      await Promise.resolve();
      inspector.remove();
      core.setRuntimeUrl(undefined);
      await vi.waitFor(() => {
        expect(core.runtimeConnectionStatus).toBe(
          CopilotKitCoreRuntimeConnectionStatus.Disconnected,
        );
      });
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      document.body.replaceChildren();
      document.getElementById("cpk-inspector-brand-fonts")?.remove();
      window.localStorage.clear();
      window.sessionStorage.clear();
    },
  };
}

test("selects the newest real thread across agents without reordering the list", async () => {
  const alphaOlder = thread(
    "alpha-older",
    "alpha",
    "Alpha older",
    "2026-08-03T11:00:00.000Z",
  );
  const betaNewer = thread(
    "beta-newer",
    "beta",
    "Beta newer",
    "2026-08-03T13:00:00.000Z",
  );
  const harness = await setup({
    alphaThreads: [alphaOlder],
    betaThreads: [betaNewer],
  });
  try {
    expect(harness.rowNames()).toEqual(["Alpha older", "Beta newer"]);

    await vi.waitFor(() => {
      expect(harness.details()?.threadId).toBe("beta-newer");
    });
    await vi.waitFor(() => {
      expect(harness.detailRequestIds()).toContain("beta-newer");
    });

    expect(new Set(harness.detailRequestIds())).toEqual(
      new Set(["beta-newer"]),
    );
    expect(harness.detailRequestIds()).not.toContain("example-realtime-sync");
    expect(harness.detailRequestIds()).not.toContain("placeholder-thread");
    expect(harness.detailRequestIds()).not.toContain("unknown-thread");
  } finally {
    await harness.teardown();
  }
});

test("tracks real source through an example-ID collision", async () => {
  const collidingRealThread = thread(
    "example-realtime-sync",
    "alpha",
    "Real thread with example ID",
    "2026-08-03T13:00:00.000Z",
  );
  const harness = await setup({
    alphaThreads: [collidingRealThread],
    betaThreads: [],
  });
  try {
    expect(harness.rowNames()).toEqual(["Real thread with example ID"]);
    expect(harness.activeRowNames()).toEqual(["Real thread with example ID"]);

    await vi.waitFor(() => {
      expect(harness.details()?.threadId).toBe("example-realtime-sync");
      expect(harness.detailRequestIds()).toContain("example-realtime-sync");
    });

    const detailRequestCountBeforeRemoval = harness.detailRequestIds().length;
    await harness.refresh("alpha", []);

    await vi.waitFor(() => {
      expect(harness.details()).toBeNull();
    });
    expect(harness.rowNames()).toEqual([
      "Realtime thread sync",
      "Manage saved conversations",
      "Inspect durable run history",
    ]);
    expect(harness.activeRowNames()).toEqual([]);
    expect(harness.inspector.shadowRoot?.textContent).toContain(
      "Threads are persistent, inspectable conversations",
    );
    expect(harness.detailRequestIds()).toHaveLength(
      detailRequestCountBeforeRemoval,
    );
  } finally {
    await harness.teardown();
  }
});

test("reselects from the active agent after the rendered context changes", async () => {
  const alphaNewest = thread(
    "alpha-newest",
    "alpha",
    "Alpha newest",
    "2026-08-03T12:00:00.000Z",
  );
  const betaNewest = thread(
    "beta-newest",
    "beta",
    "Beta newest",
    "2026-08-03T13:00:00.000Z",
  );
  const harness = await setup({
    alphaThreads: [alphaNewest],
    betaThreads: [betaNewest],
  });
  try {
    await vi.waitFor(() => {
      expect(harness.details()?.threadId).toBe("beta-newest");
    });
    const detailRequestsBeforeContextChange = harness.detailRequestIds().length;

    await harness.selectContext("alpha");

    expect(harness.rowNames()).toEqual(["Alpha newest"]);
    await vi.waitFor(() => {
      expect(harness.details()?.threadId).toBe("alpha-newest");
    });
    await vi.waitFor(() => {
      expect(harness.detailRequestIds().length).toBeGreaterThan(
        detailRequestsBeforeContextChange,
      );
    });
    const contextRequestIds = harness
      .detailRequestIds()
      .slice(detailRequestsBeforeContextChange);
    expect(contextRequestIds.length).toBeGreaterThan(0);
    expect(new Set(contextRequestIds)).toEqual(new Set(["alpha-newest"]));
  } finally {
    await harness.teardown();
  }
});

test("retains a visible explicit row through refresh and reselects after removal", async () => {
  const alphaNewest = thread(
    "alpha-newest",
    "alpha",
    "Alpha newest",
    "2026-08-03T13:00:00.000Z",
  );
  const alphaOlder = thread(
    "alpha-explicit-older",
    "alpha",
    "Alpha explicit older",
    "2026-08-03T11:00:00.000Z",
  );
  const alphaMiddle = thread(
    "alpha-middle",
    "alpha",
    "Alpha middle",
    "2026-08-03T12:00:00.000Z",
  );
  const betaThread = thread(
    "beta-thread",
    "beta",
    "Beta thread",
    "2026-08-03T14:00:00.000Z",
  );
  const harness = await setup({
    alphaThreads: [alphaNewest, alphaOlder, alphaMiddle],
    betaThreads: [betaThread],
  });
  try {
    await harness.selectContext("alpha");
    await harness.clickThread("Alpha explicit older");
    expect(harness.details()?.threadId).toBe("alpha-explicit-older");

    const retainedExplicit = thread(
      "alpha-explicit-older",
      "alpha",
      "Alpha explicit older",
      "2026-08-03T09:00:00.000Z",
    );
    const refreshedNewest = thread(
      "alpha-newest",
      "alpha",
      "Alpha newest renamed",
      "2026-08-03T15:00:00.000Z",
    );
    const refreshedMiddle = thread(
      "alpha-middle",
      "alpha",
      "Alpha middle",
      "2026-08-03T12:30:00.000Z",
    );

    await harness.refresh("alpha", [
      retainedExplicit,
      refreshedMiddle,
      refreshedNewest,
    ]);

    expect(harness.details()?.threadId).toBe("alpha-explicit-older");

    const remainingNewest = thread(
      "alpha-newest",
      "alpha",
      "Alpha newest renamed",
      "2026-08-03T16:00:00.000Z",
    );
    const remainingOlder = thread(
      "alpha-middle",
      "alpha",
      "Alpha middle",
      "2026-08-03T12:45:00.000Z",
    );

    const detailRequestsBeforeRemoval = harness.detailRequestIds().length;

    await harness.refresh("alpha", [remainingOlder, remainingNewest]);

    await vi.waitFor(() => {
      expect(harness.details()?.threadId).toBe("alpha-newest");
    });
    await vi.waitFor(() => {
      expect(harness.detailRequestIds().length).toBeGreaterThan(
        detailRequestsBeforeRemoval,
      );
    });
    const removalRequestIds = harness
      .detailRequestIds()
      .slice(detailRequestsBeforeRemoval);
    expect(new Set(removalRequestIds)).toEqual(new Set(["alpha-newest"]));

    const newestAfterFallback = thread(
      "alpha-newest-after-fallback",
      "alpha",
      "Alpha newest after fallback",
      "2026-08-03T17:00:00.000Z",
    );

    await harness.refresh("alpha", [
      remainingOlder,
      remainingNewest,
      newestAfterFallback,
    ]);

    await vi.waitFor(() => {
      expect(harness.details()?.threadId).toBe("alpha-newest-after-fallback");
    });
  } finally {
    await harness.teardown();
  }
});

test("keeps enabled-zero examples local until one is clicked", async () => {
  const harness = await setup({ alphaThreads: [], betaThreads: [] });
  try {
    expect(harness.rowNames()).toEqual([
      "Realtime thread sync",
      "Manage saved conversations",
      "Inspect durable run history",
    ]);
    expect(harness.details()).toBeNull();
    expect(harness.activeRowNames()).toEqual([]);
    expect(harness.detailRequestIds()).toEqual([]);

    await harness.clickThread("Realtime thread sync");

    await vi.waitFor(() => {
      expect(harness.details()?.threadId).toBe("example-realtime-sync");
      expect(harness.details()?.shadowRoot?.textContent).toContain(
        "Run started",
      );
    });
    expect(harness.activeRowNames()).toEqual(["Realtime thread sync"]);
    expect(harness.detailRequestIds()).toEqual([]);

    await harness.refresh("alpha", []);

    expect(harness.details()?.threadId).toBe("example-realtime-sync");
    expect(harness.activeRowNames()).toEqual(["Realtime thread sync"]);
    expect(harness.detailRequestIds()).toEqual([]);

    const realThread = thread(
      "alpha-real-after-example",
      "alpha",
      "Alpha real after example",
      "2026-08-03T18:00:00.000Z",
    );

    await harness.refresh("alpha", [realThread]);

    await vi.waitFor(() => {
      expect(harness.details()?.threadId).toBe("alpha-real-after-example");
    });
    expect(harness.activeRowNames()).toEqual(["Alpha real after example"]);
    expect(new Set(harness.detailRequestIds())).toEqual(
      new Set(["alpha-real-after-example"]),
    );
  } finally {
    await harness.teardown();
  }
});
