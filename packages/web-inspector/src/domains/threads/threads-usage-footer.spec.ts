import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkit/core";
import type { InspectorMetadataV1 } from "@copilotkit/core";
import { expect, test, vi } from "vitest";

import { WebInspectorElement } from "../../index.js";

type ThreadsUsage = NonNullable<InspectorMetadataV1["usage"]>;

type SetupOptions = {
  action?: InspectorMetadataV1["action"];
  usage?: ThreadsUsage;
};

type ThreadsUsageFooterContext = {
  core: CopilotKitCore;
  inspector: WebInspectorElement;
  selectTab: (label: string) => Promise<void>;
  toggleSettings: () => Promise<void>;
  teardown: () => void;
};

function metadata(options: SetupOptions): InspectorMetadataV1 {
  return {
    schemaVersion: 1,
    license: { state: "valid" },
    ...(options.usage === undefined ? {} : { usage: options.usage }),
    ...(options.action === undefined ? {} : { action: options.action }),
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
    if (predicate()) return;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${message}`);
}

async function setup(
  options: SetupOptions,
): Promise<ThreadsUsageFooterContext> {
  document.body.replaceChildren();
  window.localStorage.clear();
  // A returning developer on Threads: the first-run landing tab is now What's
  // new, and this suite is about the Threads footer.
  window.localStorage.setItem(
    "cpk:inspector:state",
    JSON.stringify({ selectedMenu: "threads" }),
  );
  const inspectorMetadata = metadata(options);
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
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
            list: true,
            inspect: true,
            mutations: true,
            realtimeMetadata: true,
          },
          inspectorMetadata: true,
          licenseStatus: "valid",
          telemetryDisabled: true,
        });
      }
      if (url.endsWith("/inspector-metadata")) {
        return jsonResponse(inspectorMetadata);
      }
      throw new Error(`Unexpected Inspector request: ${url}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);

  const core = new CopilotKitCore({
    runtimeUrl: "http://localhost:4000/api/copilotkit",
    runtimeTransport: "rest",
    deferInitialConnection: true,
  });
  const inspector = new WebInspectorElement();
  inspector.core = core;
  document.body.appendChild(inspector);
  core.connect();

  await waitFor(
    () =>
      core.runtimeConnectionStatus ===
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    "the Core handshake",
  );
  await waitFor(
    () => core.inspectorMetadata !== undefined,
    "Inspector metadata",
  );
  await inspector.updateComplete;
  const opener = inspector.shadowRoot?.querySelector<HTMLButtonElement>(
    'button[aria-label^="Web Inspector"]',
  );
  if (!opener) throw new Error("Web Inspector opener was not rendered");
  opener.click();
  await inspector.updateComplete;
  const threads = Array.from(
    inspector.shadowRoot?.querySelectorAll<HTMLElement>("button") ?? [],
  ).find((element) => element.textContent?.trim() === "Threads");
  if (!threads) throw new Error("Threads was not rendered");
  threads.click();
  await inspector.updateComplete;

  return {
    core,
    inspector,
    selectTab: async (label: string) => {
      const control = Array.from(
        inspector.shadowRoot?.querySelectorAll<HTMLElement>("button, a") ?? [],
      ).find((element) => element.textContent?.trim() === label);
      if (!control) throw new Error(`Inspector tab was not rendered: ${label}`);
      control.click();
      await inspector.updateComplete;
    },
    toggleSettings: async () => {
      const control = inspector.shadowRoot?.querySelector<HTMLButtonElement>(
        'button[aria-label="Settings"]',
      );
      if (!control) throw new Error("Inspector Settings was not rendered");
      control.click();
      await inspector.updateComplete;
    },
    teardown: () => {
      inspector.remove();
      core.setRuntimeUrl(undefined);
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      document.body.replaceChildren();
      window.localStorage.clear();
    },
  };
}

function requireFooter(inspector: WebInspectorElement): HTMLElement {
  const footer = inspector.shadowRoot?.querySelector<HTMLElement>(
    'footer[data-inspector-threads-footer][aria-label="Threads usage"]',
  );
  if (!footer) throw new Error("Threads usage footer was not rendered");
  return footer;
}

const usageDisplayCases = [
  {
    name: "finite usage renders an exact count and native progress",
    usage: { used: 148, limit: { kind: "finite", value: 200 } },
    countLabel: "148 / 200 Threads",
    progress: {
      max: 200,
      value: 148,
      capacity: "normal",
      ariaLabel: "148 / 200 Threads",
    },
  },
  {
    name: "finite usage stays normal immediately below ninety percent",
    usage: { used: 4_499, limit: { kind: "finite", value: 5_000 } },
    countLabel: "4499 / 5000 Threads",
    progress: {
      max: 5_000,
      value: 4_499,
      capacity: "normal",
      ariaLabel: "4499 / 5000 Threads",
    },
  },
  {
    name: "finite usage warns at exactly ninety percent",
    usage: { used: 4_500, limit: { kind: "finite", value: 5_000 } },
    countLabel: "4500 / 5000 Threads",
    progress: {
      max: 5_000,
      value: 4_500,
      capacity: "warning",
      ariaLabel: "4500 / 5000 Threads. Near thread limit.",
    },
  },
  {
    name: "finite usage keeps warning immediately below its limit",
    usage: { used: 4_999, limit: { kind: "finite", value: 5_000 } },
    countLabel: "4999 / 5000 Threads",
    progress: {
      max: 5_000,
      value: 4_999,
      capacity: "warning",
      ariaLabel: "4999 / 5000 Threads. Near thread limit.",
    },
  },
  {
    name: "finite usage is critical at exactly its limit",
    usage: { used: 5_000, limit: { kind: "finite", value: 5_000 } },
    countLabel: "5000 / 5000 Threads",
    progress: {
      max: 5_000,
      value: 5_000,
      capacity: "critical",
      ariaLabel: "5000 / 5000 Threads. Thread limit reached.",
    },
  },
  {
    name: "finite overage clamps visible count and native progress",
    usage: { used: 241, limit: { kind: "finite", value: 200 } },
    countLabel: "200+ / 200 Threads",
    progress: {
      max: 200,
      value: 200,
      capacity: "critical",
      ariaLabel: "200+ / 200 Threads. Thread limit reached.",
    },
  },
  {
    name: "unlimited usage renders its trusted count without progress",
    usage: { used: 412, limit: { kind: "unlimited" } },
    countLabel: "412 Threads · Unlimited",
  },
  {
    name: "unknown usage renders its trusted count without progress",
    usage: { used: 412, limit: { kind: "unknown" } },
    countLabel: "412 Threads · Limit unavailable",
  },
] satisfies ReadonlyArray<{
  name: string;
  usage: ThreadsUsage;
  countLabel: string;
  progress?: Readonly<{
    max: number;
    value: number;
    capacity: "normal" | "warning" | "critical";
    ariaLabel: string;
  }>;
}>;

test.each(usageDisplayCases)("$name", async (case_) => {
  const context = await setup({ usage: case_.usage });
  try {
    const footer = requireFooter(context.inspector);
    const count = footer.querySelector<HTMLElement>(
      "[data-inspector-thread-count]",
    );
    const progress = footer.querySelector<HTMLProgressElement>(
      "progress[data-inspector-thread-progress]",
    );

    expect(count?.textContent?.trim()).toBe(case_.countLabel);
    if (case_.progress === undefined) {
      expect(progress).toBeNull();
    } else {
      expect(progress).toBeInstanceOf(HTMLProgressElement);
      expect(progress?.max).toBe(case_.progress.max);
      expect(progress?.value).toBe(case_.progress.value);
      expect(progress?.dataset.inspectorThreadCapacity).toBe(
        case_.progress.capacity,
      );
      expect(progress?.getAttribute("aria-label")).toBe(
        case_.progress.ariaLabel,
      );
    }
    if (case_.usage.used === 241) {
      // Comments stripped before the substring check. lit builds its part
      // marker as `lit$` + nine digits from Math.random(), regenerated per
      // process, and writes it into the DOM as a comment — so roughly one run
      // in a hundred produced a marker containing "241" and failed this
      // assertion with no relation to what the footer showed. What the
      // assertion is actually about is that the unclamped count never reaches
      // the user, and lit's internal bookkeeping is not that.
      const rendered = footer.outerHTML.replace(/<!--[\s\S]*?-->/g, "");
      expect(rendered).not.toContain("<!--");
      expect(rendered).not.toContain("241");
      expect(context.core.inspectorMetadata?.usage?.used).toBe(241);
    }
  } finally {
    context.teardown();
  }
});

const expiryCases = [
  {
    name: "known zero expiry remains visible",
    usage: {
      used: 10,
      limit: { kind: "finite", value: 20 },
      expiringSoonCount: 0,
    },
    expiryLabel: "0 Expiring Soon",
  },
  {
    name: "positive expiry remains visible",
    usage: {
      used: 148,
      limit: { kind: "finite", value: 200 },
      expiringSoonCount: 37,
    },
    expiryLabel: "37 Expiring Soon",
  },
  {
    name: "missing expiry stays absent",
    usage: { used: 10, limit: { kind: "finite", value: 20 } },
  },
] satisfies ReadonlyArray<{
  name: string;
  usage: ThreadsUsage;
  expiryLabel?: string;
}>;

test.each(expiryCases)("$name", async (case_) => {
  const context = await setup({ usage: case_.usage });
  try {
    const footer = requireFooter(context.inspector);
    const expiry = footer.querySelector<HTMLElement>(
      "[data-inspector-thread-expiry]",
    );

    if (case_.expiryLabel === undefined) {
      expect(expiry).toBeNull();
      expect(footer.textContent).not.toContain("Expiring Soon");
    } else {
      expect(expiry?.textContent?.trim()).toBe(case_.expiryLabel);
    }
  } finally {
    context.teardown();
  }
});

const moduleCases = [
  {
    name: "usage-only metadata renders counts without an action",
    usage: { used: 8, limit: { kind: "finite", value: 20 } },
    expectedCount: "8 / 20 Threads",
    expectsAction: false,
  },
  {
    name: "action-only metadata renders the exact safe action without counts",
    action: {
      kind: "manage_plan",
      url: "https://cloud.copilotkit.ai/organizations/acme/billing",
    },
    expectsAction: true,
    expectedActionLabel: "Manage Your Plan",
    expectedActionIntent: undefined,
  },
  {
    name: "usage and action metadata share one semantic footer",
    usage: {
      used: 148,
      limit: { kind: "finite", value: 200 },
      expiringSoonCount: 37,
    },
    action: {
      kind: "manage_plan",
      url: "https://cloud.copilotkit.ai/organizations/acme/billing",
    },
    expectedCount: "148 / 200 Threads",
    expectsAction: true,
    expectedActionLabel: "Manage Your Plan",
    expectedActionIntent: undefined,
  },
  {
    name: "usage at ninety percent upgrades the trusted plan action copy",
    usage: {
      used: 4_500,
      limit: { kind: "finite", value: 5_000 },
    },
    action: {
      kind: "manage_plan",
      url: "https://cloud.copilotkit.ai/organizations/acme/billing",
    },
    expectedCount: "4500 / 5000 Threads",
    expectsAction: true,
    expectedActionLabel: "Upgrade Your Plan",
    expectedActionIntent: "upgrade",
  },
  {
    name: "usage at its limit keeps the upgrade plan action copy",
    usage: {
      used: 5_000,
      limit: { kind: "finite", value: 5_000 },
    },
    action: {
      kind: "manage_plan",
      url: "https://cloud.copilotkit.ai/organizations/acme/billing",
    },
    expectedCount: "5000 / 5000 Threads",
    expectsAction: true,
    expectedActionLabel: "Upgrade Your Plan",
    expectedActionIntent: "upgrade",
  },
] satisfies ReadonlyArray<{
  name: string;
  usage?: ThreadsUsage;
  action?: InspectorMetadataV1["action"];
  expectedCount?: string;
  expectsAction: boolean;
  expectedActionLabel?: "Manage Your Plan" | "Upgrade Your Plan";
  expectedActionIntent?: "upgrade";
}>;

test.each(moduleCases)("$name", async (case_) => {
  const context = await setup({ usage: case_.usage, action: case_.action });
  try {
    const root = context.inspector.shadowRoot!;
    const footer = requireFooter(context.inspector);
    const action = footer.querySelector<HTMLAnchorElement>(
      'a[data-inspector-action-placement="threads-footer"]',
    );
    const count = footer.querySelector<HTMLElement>(
      "[data-inspector-thread-count]",
    );

    expect(
      root.querySelectorAll("footer[data-inspector-threads-footer]"),
    ).toHaveLength(1);
    expect(count?.textContent?.trim()).toBe(case_.expectedCount);
    if (case_.expectsAction) {
      expect(action?.textContent?.trim()).toBe(case_.expectedActionLabel);
      expect(action?.href).toBe(case_.action?.url);
      expect(action?.target).toBe("_blank");
      expect(action?.rel).toContain("noopener");
      expect(action?.getAttribute("aria-label")).toBe(
        `${case_.expectedActionLabel} (opens in a new tab)`,
      );
      expect(action?.dataset.inspectorActionIntent).toBe(
        case_.expectedActionIntent,
      );
    } else {
      expect(action).toBeNull();
    }
  } finally {
    context.teardown();
  }
});

test("metadata without usage or a footer action renders no Threads footer", async () => {
  const context = await setup({});
  try {
    expect(
      context.inspector.shadowRoot?.querySelector(
        "footer[data-inspector-threads-footer]",
      ),
    ).toBeNull();
  } finally {
    context.teardown();
  }
});

test("the Threads footer stays scoped to Threads across navigation and Settings", async () => {
  const context = await setup({
    usage: { used: 148, limit: { kind: "finite", value: 200 } },
    action: {
      kind: "manage_plan",
      url: "https://cloud.copilotkit.ai/organizations/acme/billing",
    },
  });
  try {
    const findFooter = (): Element | null =>
      context.inspector.shadowRoot?.querySelector(
        "footer[data-inspector-threads-footer]",
      ) ?? null;

    expect(findFooter()).not.toBeNull();
    await context.selectTab("Agent");
    expect(findFooter()).toBeNull();
    await context.selectTab("Learning");
    expect(findFooter()).toBeNull();
    await context.selectTab("Threads");
    expect(findFooter()).not.toBeNull();
    await context.toggleSettings();
    expect(findFooter()).toBeNull();
    await context.toggleSettings();
    expect(findFooter()).not.toBeNull();
  } finally {
    context.teardown();
  }
});
