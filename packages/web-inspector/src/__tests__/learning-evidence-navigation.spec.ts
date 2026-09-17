import { createHash, webcrypto } from "node:crypto";
import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
  ɵcreateThreadStore,
  ɵselectThreadsIsLoading,
} from "@copilotkit/core";
import { parseInspectorLearningSnapshotV1 } from "@copilotkit/shared";
import { expect, test, vi } from "vitest";
import type { CpkThreadInspector } from "../index.js";
import { WebInspectorElement } from "../index.js";
import type { CpkLearningView } from "../components/learning-view.js";

class ConnectedCore extends CopilotKitCore {
  constructor() {
    super({
      runtimeUrl: "https://runtime.example.test",
      runtimeTransport: "rest",
      deferInitialConnection: true,
    });
  }
  override get threadEndpoints() {
    return {
      list: true,
      inspect: true,
      mutations: false,
      realtimeMetadata: false,
    };
  }
  override get inspectorLearning() {
    return true;
  }
  override get ɵruntimeFetch() {
    return globalThis.fetch;
  }
  override get telemetryDisabled() {
    return true;
  }
  override get runtimeConnectionStatus() {
    return CopilotKitCoreRuntimeConnectionStatus.Connected;
  }
}

/** Uses the real Learning controls, response parser, thread store, and detail renderer. */
async function setup(role = "user", withHash = true) {
  document.body.replaceChildren();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  const original = { id: "cited-message", role, content: "Check my refund." };
  const current = { ...original };
  const thread = {
    id: "thread-1",
    organizationId: "org-1",
    agentId: "default",
    name: "Refund",
    createdById: "user-1",
    archived: false,
    createdAt: "2026-09-17T12:00:00.000Z",
    updatedAt: "2026-09-17T12:00:00.000Z",
  };
  const evidence = {
    status: "available",
    threadId: thread.id,
    threadName: thread.name,
    messageIds: [original.id],
    updatedAt: thread.updatedAt,
    ...(withHash
      ? {
          messageHashes: [
            createHash("sha256")
              .update(JSON.stringify([role, original.content]))
              .digest("hex"),
          ],
        }
      : {}),
  };
  const snapshot = {
    schemaVersion: 1,
    projectKey: "project-1",
    snapshotVersion: "snapshot-1",
    webAppOrigin: "https://app.example.test",
    configuration: {
      state: "configured",
      container: { id: "learning", name: "Learning" },
    },
    pendingThreadCount: 0,
    run: { hasActiveRun: false, hasEverSucceeded: true, latest: null },
    pendingCandidateCount: 0,
    skillsPage: { page: 1, pageSize: 3, total: 0, totalPages: 0, items: [] },
    insightsPage: {
      page: 1,
      pageSize: 4,
      total: 1,
      totalPages: 1,
      items: [
        {
          id: "insight-1",
          statement: "Ask for the order.",
          impact: "Avoid wrong refunds.",
          totalThreadCount: 1,
          evidenceTruncated: false,
          evidence: [evidence],
        },
      ],
    },
    links: {
      learning: "https://app.example.test/o/acme/support/learning",
      candidates: null,
      runs: null,
    },
  };
  let removed = false;
  let eventContent: string | undefined;
  const requests: string[] = [];
  const runtimeFetch: typeof fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(url.pathname);
    const json = (data: unknown) =>
      new Response(JSON.stringify(data), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    // The runtime parses the upstream response before the browser parses it again.
    if (url.pathname.endsWith("/inspector-learning"))
      return json(parseInspectorLearningSnapshotV1(snapshot));
    if (url.pathname.endsWith("/messages"))
      return json({ messages: removed ? [] : [current] });
    if (url.pathname.endsWith("/events"))
      return json({
        events: [
          {
            type: "RUN_STARTED",
            threadId: thread.id,
            runId: "run-1",
            timestamp: thread.createdAt,
          },
          ...(role === "assistant"
            ? [
                {
                  type: "TEXT_MESSAGE_START",
                  messageId: original.id,
                  role,
                  timestamp: thread.createdAt,
                },
                {
                  type: "TEXT_MESSAGE_CONTENT",
                  messageId: original.id,
                  delta: eventContent ?? current.content,
                  timestamp: thread.createdAt,
                },
                {
                  type: "TEXT_MESSAGE_END",
                  messageId: original.id,
                  timestamp: thread.createdAt,
                },
              ]
            : []),
        ],
      });
    if (url.pathname.endsWith("/state")) return json({ state: {} });
    if (url.pathname.endsWith("/threads"))
      return json({ threads: [thread], joinCode: null });
    if (url.pathname.endsWith("/" + thread.id)) return json({ thread });
    if (url.hostname === "cdn.copilotkit.ai")
      return new Response(null, { status: 404 });
    throw new Error("Unexpected request " + url.href);
  };
  vi.stubGlobal("fetch", runtimeFetch);
  const store = ɵcreateThreadStore({ fetch: runtimeFetch });
  store.start();
  store.setContext({
    runtimeUrl: "https://runtime.example.test",
    headers: {},
    agentId: "default",
  });
  await vi.waitFor(() =>
    expect(ɵselectThreadsIsLoading(store.getState())).toBe(false),
  );
  const core = new ConnectedCore();
  core.registerThreadStore("default", store);
  const inspector = new WebInspectorElement();
  document.body.append(inspector);
  inspector.core = core;
  await inspector.updateComplete;
  inspector
    .shadowRoot!.querySelector<HTMLButtonElement>(
      'button[aria-label^="Web Inspector"]',
    )!
    .click();
  await inspector.updateComplete;
  inspector
    .shadowRoot!.querySelector<HTMLButtonElement>(
      'button[data-inspector-menu-key="memories"]',
    )!
    .click();
  const view = () =>
    inspector.shadowRoot!.querySelector<CpkLearningView>("cpk-learning-view")!;
  await vi.waitFor(() =>
    expect(
      view()?.shadowRoot?.querySelector(".insight-row") ?? null,
    ).not.toBeNull(),
  );
  view().shadowRoot!.querySelector<HTMLButtonElement>(".insight-row")!.click();
  await view().updateComplete;
  return {
    inspector,
    current,
    original,
    requests,
    remove: () => {
      removed = true;
    },
    setEventContent: (content: string) => {
      eventContent = content;
    },
    click: () =>
      view()
        .shadowRoot!.querySelector<HTMLButtonElement>(".evidence-link")!
        .click(),
    detail: () =>
      inspector.shadowRoot!.querySelector<CpkThreadInspector>(
        "cpk-thread-details",
      ),
    teardown: () => {
      inspector.remove();
      core.unregisterThreadStore("default");
      store.stop();
      vi.unstubAllGlobals();
    },
  };
}

test.each(["user", "assistant"])(
  "unchanged %s evidence highlights the verified text",
  async (role) => {
    const harness = await setup(role);
    try {
      harness.click();

      await vi.waitFor(() => {
        const row = harness
          .detail()
          ?.shadowRoot?.querySelector('[data-message-id="cited-message"]');
        expect(row?.textContent).toContain(harness.original.content);
        expect(row?.classList.contains("cpk-td__focus-pulse")).toBe(true);
      });
    } finally {
      harness.teardown();
    }
  },
);

test.each([
  "user edit",
  "assistant edit",
  "role edit",
  "removed",
  "old runtime",
  "event mismatch",
  "crypto unavailable",
])(
  "%s after Learning loads never highlights unverified evidence",
  async (scenario) => {
    const harness = await setup(
      scenario.startsWith("assistant") || scenario === "event mismatch"
        ? "assistant"
        : "user",
      scenario !== "old runtime",
    );
    try {
      if (scenario.endsWith(" edit") && scenario !== "role edit")
        harness.current.content = "What is the weather?";
      if (scenario === "role edit") harness.current.role = "assistant";
      if (scenario === "removed") harness.remove();
      if (scenario === "event mismatch")
        harness.setEventContent("What is the weather?");
      if (scenario === "crypto unavailable") vi.stubGlobal("crypto", {});
      harness.click();

      await vi.waitFor(() =>
        expect(
          harness.detail()?.shadowRoot?.querySelector('[role="status"]')
            ?.textContent ?? "",
        ).toContain("Evidence is no longer available"),
      );
      expect(
        harness.detail()?.shadowRoot?.querySelector(".cpk-td__focus-pulse"),
      ).toBeNull();
      expect(
        harness.requests.filter((path) => path.endsWith("/messages")),
      ).toHaveLength(1);
    } finally {
      harness.teardown();
    }
  },
);

test("a live content edit clears an existing evidence highlight", async () => {
  const harness = await setup();
  try {
    harness.click();
    await vi.waitFor(() =>
      expect(
        harness.detail()?.shadowRoot?.querySelector(".cpk-td__focus-pulse"),
      ).not.toBeNull(),
    );

    harness.current.content = "What is the weather?";
    harness.detail()!.liveMessageVersion += 1;

    await vi.waitFor(() =>
      expect(
        harness.detail()?.shadowRoot?.querySelector('[role="status"]')
          ?.textContent ?? "",
      ).toContain("Evidence is no longer available"),
    );
    expect(
      harness.detail()?.shadowRoot?.querySelector(".cpk-td__focus-pulse"),
    ).toBeNull();
  } finally {
    harness.teardown();
  }
});

test("a pending fingerprint check cannot highlight a message changed during verification", async () => {
  const harness = await setup();
  const digest = webcrypto.subtle.digest.bind(webcrypto.subtle);
  let finish: (value: ArrayBuffer) => void = () => {
    throw new Error("Digest has not started");
  };
  const pending = new Promise<ArrayBuffer>((resolve) => {
    finish = resolve;
  });
  const spy = vi.spyOn(webcrypto.subtle, "digest").mockReturnValueOnce(pending);
  try {
    harness.click();
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());

    harness.current.content = "What is the weather?";
    harness.detail()!.liveMessageVersion += 1;
    await vi.waitFor(() =>
      expect(harness.detail()?.shadowRoot?.textContent).toContain(
        "What is the weather?",
      ),
    );
    finish(
      await digest(
        "SHA-256",
        new TextEncoder().encode(
          JSON.stringify(["user", harness.original.content]),
        ),
      ),
    );

    await vi.waitFor(() =>
      expect(
        harness.detail()?.shadowRoot?.querySelector('[role="status"]')
          ?.textContent ?? "",
      ).toContain("Evidence is no longer available"),
    );
    expect(
      harness.detail()?.shadowRoot?.querySelector(".cpk-td__focus-pulse"),
    ).toBeNull();
  } finally {
    spy.mockRestore();
    harness.teardown();
  }
});
