import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkit/core";
import type {
  CopilotKitCoreSubscriber,
  InspectorMetadataV1,
  RuntimeLicenseStatus,
} from "@copilotkit/core";
import { expect, test, vi } from "vitest";

import { WebInspectorElement } from "../index.js";

type SetupOptions = {
  metadata?: InspectorMetadataV1;
  metadataResponses?: InspectorMetadataV1[];
  metadataSupported?: boolean;
  runtimeLicense?: RuntimeLicenseStatus;
  threadsAvailable?: boolean;
};

type InspectorContext = {
  core: CopilotKitCore;
  inspector: WebInspectorElement;
  requests: string[];
  open: () => Promise<void>;
  selectTab: (label: string) => Promise<void>;
  teardown: () => void;
};

function fullMetadata(
  licenseState: "valid" | "none" | "expired" | "unknown" = "valid",
  actionKind: "manage_plan" | "renew" | "enable_intelligence" = "manage_plan",
  label = "Enterprise",
): InspectorMetadataV1 {
  return {
    schemaVersion: 1,
    identity: {
      organizationName: "Acme Inc.",
      projectName: "Support",
    },
    plan: { code: label.toLowerCase(), label },
    license: { state: licenseState },
    action: {
      kind: actionKind,
      url: `https://cloud.copilotkit.ai/actions/${actionKind}`,
    },
    usage: {
      used: 148,
      limit: { kind: "finite", value: 200 },
      expiringSoonCount: 37,
    },
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function waitFor(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${message}`);
}

function findControl(root: ShadowRoot, label: string): HTMLElement | undefined {
  return Array.from(root.querySelectorAll<HTMLElement>("button, a")).find(
    (element) => element.textContent?.trim() === label,
  );
}

async function setup(options: SetupOptions = {}): Promise<InspectorContext> {
  document.body.replaceChildren();
  window.localStorage.clear();
  // A returning developer on Threads: the first-run landing tab is now What's
  // new, and the Threads footer is what this suite renders.
  window.localStorage.setItem(
    "cpk:inspector:state",
    JSON.stringify({ selectedMenu: "threads" }),
  );
  const requests: string[] = [];
  const metadataResponses = [
    ...(options.metadataResponses ??
      (options.metadata === undefined ? [] : [options.metadata])),
  ];
  const metadataSupported = options.metadataSupported ?? true;
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      requests.push(url);

      if (url === "https://cdn.copilotkit.ai/announcements.json") {
        return new Response(null, { status: 404 });
      }

      if (url.endsWith("/info")) {
        return jsonResponse({
          version: "1.0.0",
          agents: {},
          audioFileTranscriptionEnabled: false,
          mode: "sse",
          threadEndpoints: {
            list: options.threadsAvailable ?? false,
            inspect: options.threadsAvailable ?? false,
            mutations: options.threadsAvailable ?? false,
            realtimeMetadata: options.threadsAvailable ?? false,
          },
          inspectorMetadata: metadataSupported,
          licenseStatus: options.runtimeLicense,
          telemetryDisabled: true,
        });
      }

      if (url.endsWith("/inspector-metadata")) {
        const response = metadataResponses.shift();
        return response === undefined
          ? new Response(null, { status: 204 })
          : jsonResponse(response);
      }

      const method =
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as { method?: string }).method
          : undefined;
      if (method === "info") {
        throw new Error("This component harness expects REST transport");
      }

      throw new Error(`Unexpected inspector request: ${url}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);

  const core = new CopilotKitCore({
    runtimeUrl: "http://localhost:4000/api/copilotkit",
    runtimeTransport: "rest",
    deferInitialConnection: true,
  });
  const inspector = new WebInspectorElement();
  Reflect.set(inspector, "autoAttachCore", false);
  document.body.appendChild(inspector);
  inspector.core = core;
  core.connect();

  await waitFor(
    () =>
      core.runtimeConnectionStatus ===
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    "the Core handshake",
  );
  if (metadataResponses.length > 0 || options.metadata !== undefined) {
    await waitFor(
      () => core.inspectorMetadata !== undefined,
      "the initial inspector metadata",
    );
  }
  await inspector.updateComplete;

  return {
    core,
    inspector,
    requests,
    open: async () => {
      const button = inspector.shadowRoot?.querySelector<HTMLButtonElement>(
        'button[aria-label^="Web Inspector"]',
      );
      if (!button) {
        throw new Error("Web Inspector opener was not rendered");
      }
      button.click();
      await inspector.updateComplete;
    },
    selectTab: async (label: string) => {
      const root = inspector.shadowRoot;
      if (!root) {
        throw new Error("Web Inspector has no shadow root");
      }
      const control = findControl(root, label);
      if (!control) {
        throw new Error(`Web Inspector tab not found: ${label}`);
      }
      control.click();
      await inspector.updateComplete;
    },
    teardown: () => {
      inspector.remove();
      core.setRuntimeUrl(undefined);
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      document.body.replaceChildren();
    },
  };
}

test("renders the trusted manage link in the Threads usage footer", async () => {
  const context = await setup({
    metadata: fullMetadata(),
    runtimeLicense: "valid",
    threadsAvailable: true,
  });
  try {
    await context.open();

    const root = context.inspector.shadowRoot!;
    const identity = root.querySelector('[data-inspector-metadata="identity"]');
    const plan = root.querySelector('[data-inspector-metadata="plan"]');
    expect(identity?.textContent).toContain("Support");
    expect(identity?.textContent).toContain("Acme Inc.");
    expect(plan?.textContent).toContain("Enterprise");
    await context.selectTab("Threads");
    const action = root.querySelector<HTMLAnchorElement>(
      '[data-inspector-action-placement="threads-footer"]',
    );
    expect(action?.textContent?.trim()).toBe("Manage Your Plan");
    expect(action?.getAttribute("aria-label")).toBe(
      "Manage Your Plan (opens in a new tab)",
    );
    expect(action?.href).toBe(
      "https://cloud.copilotkit.ai/actions/manage_plan",
    );
    expect(action?.target).toBe("_blank");
    expect(action?.rel).toContain("noopener");
  } finally {
    context.teardown();
  }
});

test("keeps the Threads footer action clickable outside the drag handle", async () => {
  const context = await setup({
    metadata: fullMetadata(),
    runtimeLicense: "valid",
    threadsAvailable: true,
  });
  try {
    await context.open();
    await context.selectTab("Threads");

    const action =
      context.inspector.shadowRoot?.querySelector<HTMLAnchorElement>(
        '[data-inspector-action-placement="threads-footer"]',
      );
    if (!action) {
      throw new Error("Threads footer metadata action was not rendered");
    }
    const pointerDown = new Event("pointerdown", {
      bubbles: true,
      cancelable: true,
    });

    expect(action.dispatchEvent(pointerDown)).toBe(true);
    expect(pointerDown.defaultPrevented).toBe(false);
    expect(action.closest('[data-drag-context="window"]')).toBeNull();
  } finally {
    context.teardown();
  }
});

test.each([
  ["valid", "manage_plan"],
  ["none", "enable_intelligence"],
  ["expired", "renew"],
  ["unknown", "manage_plan"],
] as const)(
  "working Threads stay unlocked for %s metadata",
  async (licenseState, actionKind) => {
    const context = await setup({
      metadata: fullMetadata(licenseState, actionKind),
      runtimeLicense: licenseState,
      threadsAvailable: true,
    });
    try {
      await context.open();
      await context.selectTab("Threads");

      const root = context.inspector.shadowRoot!;
      expect(root.querySelector("cpk-thread-list")).not.toBeNull();
      expect(
        root.querySelector('[data-inspector-action-placement="locked"]'),
      ).toBeNull();
      expect(root.textContent).not.toContain("Threads are unavailable");
    } finally {
      context.teardown();
    }
  },
);

test.each([
  ["valid", "manage_plan", "Finish setting up Rich Threads", undefined],
  [
    "none",
    "enable_intelligence",
    "Enable Intelligence to inspect Threads.",
    "Enable Intelligence",
  ],
  ["expired", "renew", "Renew Intelligence to inspect Threads.", "Renew"],
  ["unknown", "manage_plan", "Threads are unavailable.", undefined],
] as const)(
  "locked Threads use %s license copy and action placement",
  async (licenseState, actionKind, heading, actionLabel) => {
    const context = await setup({
      metadata: fullMetadata(licenseState, actionKind),
      runtimeLicense: licenseState,
      threadsAvailable: false,
    });
    try {
      await context.open();
      await context.selectTab("Threads");

      const root = context.inspector.shadowRoot!;
      const action = root.querySelector<HTMLAnchorElement>(
        '[data-inspector-action-placement="locked"]',
      );
      expect(root.textContent).toContain(heading);
      expect(action?.textContent?.trim()).toBe(actionLabel);
      if (actionLabel !== undefined) {
        expect(action?.href).toBe(
          `https://cloud.copilotkit.ai/actions/${actionKind}`,
        );
      }
    } finally {
      context.teardown();
    }
  },
);

test("renders valid partial modules without identity placeholders", async () => {
  const partial = {
    schemaVersion: 1,
    identity: { organizationName: "Acme", projectName: " " },
    plan: { code: "developer", label: " Developer " },
    license: { state: "valid" },
  } satisfies InspectorMetadataV1;
  const context = await setup({
    metadata: partial,
    runtimeLicense: "valid",
    threadsAvailable: true,
  });
  try {
    await context.open();

    const root = context.inspector.shadowRoot!;
    expect(
      root.querySelector('[data-inspector-metadata="identity"]'),
    ).toBeNull();
    expect(
      root.querySelector('[data-inspector-metadata="plan"]')?.textContent,
    ).toContain("Developer");
    expect(root.textContent).not.toContain("Free");
  } finally {
    context.teardown();
  }
});

test("an old runtime omits metadata UI and keeps the generic locked fallback", async () => {
  const context = await setup({
    metadataSupported: false,
    threadsAvailable: false,
  });
  try {
    await context.open();
    await context.selectTab("Threads");

    const root = context.inspector.shadowRoot!;
    expect(root.querySelector("[data-inspector-metadata]")).toBeNull();
    expect(root.querySelector("[data-inspector-action-placement]")).toBeNull();
    expect(root.textContent).toContain("Threads are unavailable.");
  } finally {
    context.teardown();
  }
});

test("an old Core without metadata members attaches and renders without error", async () => {
  document.body.replaceChildren();
  window.localStorage.clear();
  const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
  vi.stubGlobal("fetch", fetchMock);
  const subscribers = new Set<CopilotKitCoreSubscriber>();
  const oldCore = {
    agents: {},
    context: {},
    properties: {},
    runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Connected,
    runtimeMode: "sse",
    telemetryDisabled: true,
    subscribe(subscriber: CopilotKitCoreSubscriber) {
      subscribers.add(subscriber);
      return { unsubscribe: () => subscribers.delete(subscriber) };
    },
    getThreadStores: () => ({}),
    getThreadStore: () => undefined,
  };
  const inspector = new WebInspectorElement();
  Reflect.set(inspector, "autoAttachCore", false);
  document.body.appendChild(inspector);
  Reflect.set(inspector, "core", oldCore);
  try {
    await inspector.updateComplete;
    inspector.shadowRoot
      ?.querySelector<HTMLButtonElement>('button[aria-label^="Web Inspector"]')
      ?.click();
    await inspector.updateComplete;

    expect(
      inspector.shadowRoot?.querySelector("[data-inspector-metadata]"),
    ).toBeNull();
    expect(inspector.shadowRoot?.textContent).toContain("Events");
  } finally {
    inspector.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  }
});

test("known license disagreement uses Runtime copy and hides the metadata action", async () => {
  const context = await setup({
    metadata: fullMetadata("none", "enable_intelligence"),
    runtimeLicense: "expired",
    threadsAvailable: false,
  });
  try {
    await context.open();
    await context.selectTab("Threads");

    const root = context.inspector.shadowRoot!;
    expect(root.textContent).toContain(
      "Renew Intelligence to inspect Threads.",
    );
    expect(
      root.querySelector('[data-inspector-action-placement="locked"]'),
    ).toBeNull();
    expect(root.textContent).not.toContain("Enable Intelligence");
  } finally {
    context.teardown();
  }
});

test("metadata refresh rerenders without resetting the selected example or requesting Threads", async () => {
  const initial = fullMetadata("valid", "manage_plan", "Enterprise");
  const refreshed = fullMetadata("valid", "manage_plan", "Scale");
  const context = await setup({
    metadataResponses: [initial, refreshed],
    runtimeLicense: "valid",
    threadsAvailable: true,
  });
  try {
    await context.open();
    await context.selectTab("Threads");
    const list = context.inspector.shadowRoot?.querySelector("cpk-thread-list");
    await waitFor(
      () => list?.shadowRoot?.querySelector(".cpk-tl__item") !== null,
      "the example thread list",
    );
    list?.shadowRoot?.querySelector<HTMLElement>(".cpk-tl__item")?.click();
    await context.inspector.updateComplete;
    const selectedBefore = Reflect.get(
      context.inspector.shadowRoot?.querySelector("cpk-thread-details") ?? {},
      "threadId",
    );
    const threadRequestsBefore = context.requests.filter((url) =>
      url.includes("/threads?"),
    ).length;

    context.core.setHeaders({ Authorization: "Bearer refreshed" });
    await context.selectTab("Home");
    await waitFor(
      () =>
        context.inspector.shadowRoot
          ?.querySelector('[data-inspector-metadata="plan"]')
          ?.textContent?.includes("Scale") === true,
      "the refreshed plan label",
    );
    await context.selectTab("Threads");

    const selectedAfter = Reflect.get(
      context.inspector.shadowRoot?.querySelector("cpk-thread-details") ?? {},
      "threadId",
    );
    const threadRequestsAfter = context.requests.filter((url) =>
      url.includes("/threads?"),
    ).length;
    expect(selectedAfter).toBe(selectedBefore);
    expect(selectedAfter).toBe("example-realtime-sync");
    expect(threadRequestsAfter).toBe(threadRequestsBefore);
  } finally {
    context.teardown();
  }
});

test("metadata usage stays independent from Threads capability and debug navigation", async () => {
  const context = await setup({
    metadata: fullMetadata("none", "enable_intelligence"),
    runtimeLicense: "none",
    threadsAvailable: false,
  });
  try {
    await context.open();
    await context.selectTab("Threads");

    const root = context.inspector.shadowRoot!;
    const usage = context.core.inspectorMetadata?.usage;
    const talk = findControl(root, "Talk to an Engineer");
    const lockedAction = root.querySelector<HTMLAnchorElement>(
      '[data-inspector-action-placement="locked"]',
    );
    expect(usage).toStrictEqual({
      used: 148,
      limit: { kind: "finite", value: 200 },
      expiringSoonCount: 37,
    });
    expect(
      Object.prototype.hasOwnProperty.call(usage ?? {}, "expiringSoonCount"),
    ).toBe(true);
    expect(root.textContent).toContain(
      "Enable Intelligence to inspect Threads.",
    );
    expect(lockedAction?.textContent?.trim()).toBe("Enable Intelligence");
    expect(lockedAction?.href).toBe(
      "https://cloud.copilotkit.ai/actions/enable_intelligence",
    );
    expect(
      context.requests.filter((url) => url.includes("/threads?")),
    ).toHaveLength(0);
    expect(talk).toBeInstanceOf(HTMLAnchorElement);
    expect(talk).not.toBe(lockedAction);
    for (const label of ["Home", "Threads", "Learning", "Agent"]) {
      expect(findControl(root, label), label).toBeDefined();
    }
    await context.selectTab("Agent");
    for (const label of ["Events", "Agent", "Context"]) {
      expect(findControl(root, label), label).toBeDefined();
    }
  } finally {
    context.teardown();
  }
});
