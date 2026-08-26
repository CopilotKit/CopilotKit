import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkit/core";
import type { InspectorMetadataV1 } from "@copilotkit/core";
import { expect, test, vi } from "vitest";

import { WebInspectorElement } from "../index.js";
import { TELEMETRY_EVENTS, TELEMETRY_INGEST_URL } from "../lib/telemetry.js";

type TelemetryBody = {
  event: string;
  properties: Readonly<{ [key: string]: unknown }>;
};

type SetupOptions = {
  metadataResponses: InspectorMetadataV1[];
  telemetryDisabled?: boolean;
  threadsAvailable?: boolean;
  rejectTelemetry?: boolean;
};

type InspectorTelemetryContext = {
  core: CopilotKitCore;
  inspector: WebInspectorElement;
  telemetryBodies: TelemetryBody[];
  open: () => Promise<void>;
  close: () => Promise<void>;
  selectTab: (label: string) => Promise<void>;
  teardown: () => void;
};

function fullMetadata(
  options: {
    organizationName?: string;
    planLabel?: string;
    licenseState?: "valid" | "none" | "expired" | "unknown";
    actionKind?: "manage_plan" | "renew" | "enable_intelligence";
  } = {},
): InspectorMetadataV1 {
  const organizationName = options.organizationName ?? "Acme Inc.";
  const planLabel = options.planLabel ?? "Enterprise";
  const licenseState = options.licenseState ?? "valid";
  const actionKind = options.actionKind ?? "manage_plan";
  return {
    schemaVersion: 1,
    identity: { organizationName, projectName: "Support" },
    plan: { code: planLabel.toLowerCase(), label: planLabel },
    license: { state: licenseState },
    action: {
      kind: actionKind,
      url: `https://cloud.copilotkit.ai/actions/${actionKind}`,
    },
    usage: {
      used: 148,
      limit: { kind: "finite", value: 200 },
    },
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function isProperties(
  value: unknown,
): value is Readonly<{ [key: string]: unknown }> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTelemetryBody(raw: string): TelemetryBody {
  const parsed: unknown = JSON.parse(raw);
  if (
    !isProperties(parsed) ||
    typeof parsed.event !== "string" ||
    !isProperties(parsed.properties)
  ) {
    throw new Error("Telemetry request body had an unexpected shape");
  }
  return { event: parsed.event, properties: parsed.properties };
}

function requireShadowRoot(inspector: WebInspectorElement): ShadowRoot {
  if (!inspector.shadowRoot) {
    throw new Error("Web Inspector shadow root was not rendered");
  }
  return inspector.shadowRoot;
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

function findControl(root: ShadowRoot, label: string): HTMLElement | undefined {
  return Array.from(root.querySelectorAll<HTMLElement>("button, a")).find(
    (element) => element.textContent?.trim() === label,
  );
}

function metadataBodies(context: InspectorTelemetryContext): TelemetryBody[] {
  return context.telemetryBodies.filter(
    ({ event }) => event === TELEMETRY_EVENTS.metadataModuleViewed,
  );
}

async function setup(
  options: SetupOptions,
): Promise<InspectorTelemetryContext> {
  document.body.replaceChildren();
  window.localStorage.clear();
  // A returning developer on Threads: the first-run landing tab is now What's
  // new, and this suite measures the Threads-scoped metadata surfaces.
  window.localStorage.setItem(
    "cpk:inspector:state",
    JSON.stringify({ selectedMenu: "threads" }),
  );
  const metadataResponses = [...options.metadataResponses];
  const telemetryBodies: TelemetryBody[] = [];
  const fetchMock = vi.fn(
    async (
      input: RequestInfo | URL,
      _init?: RequestInit,
    ): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === TELEMETRY_INGEST_URL) {
        const request = input instanceof Request ? input : undefined;
        const body = request ? await request.clone().text() : "";
        if (body) telemetryBodies.push(parseTelemetryBody(body));
        if (options.rejectTelemetry) throw new Error("telemetry unavailable");
        return new Response(null, { status: 204 });
      }
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
            list: options.threadsAvailable ?? true,
            inspect: options.threadsAvailable ?? true,
            mutations: options.threadsAvailable ?? true,
            realtimeMetadata: options.threadsAvailable ?? true,
          },
          inspectorMetadata: true,
          licenseStatus: options.metadataResponses[0]?.license?.state,
          telemetryDisabled: options.telemetryDisabled ?? false,
        });
      }
      if (url.endsWith("/inspector-metadata")) {
        const response = metadataResponses.shift();
        return response === undefined
          ? new Response(null, { status: 204 })
          : jsonResponse(response);
      }
      throw new Error(`Unexpected Inspector request: ${url}`);
    },
  );
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === TELEMETRY_INGEST_URL) {
      const body = parseTelemetryBody(String(init?.body));
      telemetryBodies.push(body);
      if (options.rejectTelemetry) {
        return Promise.reject(new Error("telemetry unavailable"));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return fetchMock(input, init);
  });

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
    "the initial Inspector metadata",
  );
  await inspector.updateComplete;

  return {
    core,
    inspector,
    telemetryBodies,
    open: async () => {
      const button = inspector.shadowRoot?.querySelector<HTMLButtonElement>(
        'button[aria-label^="Web Inspector"]',
      );
      if (!button) throw new Error("Web Inspector opener was not rendered");
      button.click();
      await inspector.updateComplete;
    },
    close: async () => {
      const button = inspector.shadowRoot?.querySelector<HTMLButtonElement>(
        'button[aria-label="Close Web Inspector"]',
      );
      if (!button)
        throw new Error("Web Inspector close button was not rendered");
      button.click();
      await inspector.updateComplete;
    },
    selectTab: async (label: string) => {
      const root = inspector.shadowRoot;
      if (!root) throw new Error("Web Inspector has no shadow root");
      const control = findControl(root, label);
      if (!control) throw new Error(`Web Inspector tab not found: ${label}`);
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

test("metadata impressions wait for an open connected Inspector and use last-fingerprint dedupe", async () => {
  const initial = fullMetadata();
  const changedPlan = fullMetadata({ planLabel: "Scale" });
  const context = await setup({
    metadataResponses: [initial, changedPlan, initial],
  });
  try {
    expect(metadataBodies(context)).toEqual([]);

    await context.open();
    await context.selectTab("Threads");

    expect(
      metadataBodies(context).map(({ properties }) => properties.module),
    ).toEqual(["identity", "plan", "identity", "plan", "action"]);

    await context.core.refreshInspectorMetadata();
    await waitFor(
      () => metadataBodies(context).length === 6,
      "the changed plan impression",
    );
    expect(
      metadataBodies(context).map(({ properties }) => properties.module),
    ).toEqual(["identity", "plan", "identity", "plan", "action", "plan"]);

    await context.core.refreshInspectorMetadata();
    await waitFor(
      () => metadataBodies(context).length === 7,
      "the A-to-B-to-A plan impression",
    );
    expect(metadataBodies(context).at(-1)?.properties.module).toBe("plan");

    await context.close();
    await context.open();

    expect(metadataBodies(context)).toHaveLength(7);
  } finally {
    context.teardown();
  }
});

test("a metadata module re-emits after an open-panel absent transition", async () => {
  const initial = fullMetadata();
  const { plan: _drop, ...withoutPlan } = fullMetadata();
  const context = await setup({
    metadataResponses: [initial, withoutPlan, initial],
  });
  try {
    await context.open();
    await context.selectTab("Threads");
    expect(metadataBodies(context)).toHaveLength(5);

    await context.core.refreshInspectorMetadata();
    await context.inspector.updateComplete;
    expect(metadataBodies(context)).toHaveLength(5);

    await context.core.refreshInspectorMetadata();
    await waitFor(
      () => metadataBodies(context).length === 6,
      "the plan impression after its absent state",
    );

    expect(metadataBodies(context).at(-1)?.properties.module).toBe("plan");
  } finally {
    context.teardown();
  }
});

test("Threads footer action emits one impression per visible transition and one coarse click", async () => {
  const context = await setup({
    metadataResponses: [fullMetadata()],
    threadsAvailable: true,
  });
  try {
    await context.open();
    await context.selectTab("Threads");

    const root = requireShadowRoot(context.inspector);
    const actions = root.querySelectorAll<HTMLAnchorElement>(
      "[data-inspector-action-placement]",
    );
    const action = root.querySelector<HTMLAnchorElement>(
      '[data-inspector-action-placement="threads-footer"]',
    );
    expect(actions).toHaveLength(1);
    expect(action?.textContent?.trim()).toBe("Manage Your Plan");
    const actionViews = metadataBodies(context).filter(
      ({ properties }) => properties.module === "action",
    );
    expect(actionViews).toHaveLength(1);
    expect(actionViews[0]?.properties).toMatchObject({
      usage_bucket: "within_limit",
      expiry_bucket: "unavailable",
      group_key: "workbench",
      leaf_key: "threads",
      action_placement: "threads_footer",
    });

    action?.dispatchEvent(new Event("click"));
    await Promise.resolve();

    const clicks = context.telemetryBodies.filter(
      ({ event }) => event === TELEMETRY_EVENTS.metadataActionClicked,
    );
    expect(clicks).toHaveLength(1);
    expect({
      module: clicks[0]?.properties.module,
      action_kind: clicks[0]?.properties.action_kind,
      license_bucket: clicks[0]?.properties.license_bucket,
      usage_bucket: clicks[0]?.properties.usage_bucket,
      expiry_bucket: clicks[0]?.properties.expiry_bucket,
      group_key: clicks[0]?.properties.group_key,
      leaf_key: clicks[0]?.properties.leaf_key,
      action_placement: clicks[0]?.properties.action_placement,
    }).toStrictEqual({
      module: "action",
      action_kind: "manage_plan",
      license_bucket: "valid",
      usage_bucket: "within_limit",
      expiry_bucket: "unavailable",
      group_key: "workbench",
      leaf_key: "threads",
      action_placement: "threads_footer",
    });
    expect(clicks[0]?.properties).not.toHaveProperty("placement");
    expect(JSON.stringify(clicks[0]?.properties)).not.toMatch(
      /cloud\.copilotkit\.ai/,
    );

    await context.selectTab("Agent");
    expect(
      root.querySelector('[data-inspector-action-placement="threads-footer"]'),
    ).toBeNull();
    expect(
      metadataBodies(context).filter(
        ({ properties }) => properties.module === "action",
      ),
    ).toHaveLength(1);

    await context.selectTab("Threads");
    expect(
      root.querySelectorAll(
        '[data-inspector-action-placement="threads-footer"]',
      ),
    ).toHaveLength(1);
    expect(
      metadataBodies(context).filter(
        ({ properties }) => properties.module === "action",
      ),
    ).toHaveLength(2);
    expect(
      context.telemetryBodies.filter(
        ({ event }) => event === TELEMETRY_EVENTS.metadataActionClicked,
      ),
    ).toHaveLength(1);
  } finally {
    context.teardown();
  }
});

test("a valid manage action emits one footer impression when Threads endpoints are locked", async () => {
  const context = await setup({
    metadataResponses: [fullMetadata()],
    threadsAvailable: false,
  });
  try {
    await context.open();
    await context.selectTab("Threads");

    const root = requireShadowRoot(context.inspector);
    const footer = root.querySelectorAll("[data-inspector-threads-footer]");
    const action = root.querySelectorAll("[data-inspector-threads-footer] a");
    expect(footer).toHaveLength(1);
    expect(action).toHaveLength(1);
    const actionViews = metadataBodies(context).filter(
      ({ properties }) => properties.module === "action",
    );
    expect(actionViews).toHaveLength(1);
    expect(actionViews[0]?.properties.action_placement).toBe("threads_footer");
    expect(
      context.telemetryBodies.filter(
        ({ event }) => event === TELEMETRY_EVENTS.metadataActionClicked,
      ),
    ).toEqual([]);
  } finally {
    context.teardown();
  }
});

const metadataActionCases = [
  {
    name: "manage plan",
    metadata: fullMetadata(),
    threadsAvailable: true,
    label: "Manage plan",
    expectedKind: "manage_plan",
  },
  {
    name: "renew",
    metadata: fullMetadata({
      licenseState: "expired",
      actionKind: "renew",
    }),
    threadsAvailable: false,
    label: "Renew",
    expectedKind: "renew",
  },
] satisfies ReadonlyArray<{
  name: string;
  metadata: InspectorMetadataV1;
  threadsAvailable: boolean;
  label: string;
  expectedKind: "manage_plan" | "renew";
}>;

test.each(metadataActionCases)(
  "$name metadata action clicks emit a countable coarse event",
  async (case_) => {
    const context = await setup({
      metadataResponses: [case_.metadata],
      threadsAvailable: case_.threadsAvailable,
    });
    try {
      await context.open();
      await context.selectTab("Threads");
      const action =
        context.inspector.shadowRoot?.querySelector<HTMLAnchorElement>(
          `[data-inspector-action-placement="${
            case_.threadsAvailable ? "threads-footer" : "locked"
          }"]`,
        );
      if (!action) throw new Error(`${case_.label} action was not rendered`);

      action.dispatchEvent(new Event("click"));
      action.dispatchEvent(new Event("click"));
      await Promise.resolve();

      const clicks = context.telemetryBodies.filter(
        ({ event }) => event === TELEMETRY_EVENTS.metadataActionClicked,
      );
      expect(clicks).toHaveLength(2);
      for (const click of clicks) {
        expect(click.properties).toMatchObject({
          module: "action",
          action_kind: case_.expectedKind,
          license_bucket: case_.threadsAvailable ? "valid" : "expired",
          usage_bucket: "within_limit",
          expiry_bucket: "unavailable",
          group_key: "workbench",
          leaf_key: "threads",
          action_placement: case_.threadsAvailable
            ? "threads_footer"
            : "threads_locked",
        });
      }
    } finally {
      context.teardown();
    }
  },
);

test("enable Intelligence stays on its existing event without a generic double count", async () => {
  const context = await setup({
    metadataResponses: [
      fullMetadata({ licenseState: "none", actionKind: "enable_intelligence" }),
    ],
    threadsAvailable: false,
  });
  try {
    await context.open();
    await context.selectTab("Threads");
    expect(
      metadataBodies(context).map(({ properties }) => properties.module),
    ).toEqual(["identity", "plan", "identity", "plan", "action"]);

    expect(metadataBodies(context).at(-1)?.properties).toMatchObject({
      module: "action",
      action_kind: "enable_intelligence",
      license_bucket: "none",
    });

    const toggleSettings = async (): Promise<void> => {
      const settings = context.inspector.shadowRoot?.querySelector<HTMLElement>(
        'button[aria-label="Settings"]',
      );
      if (!settings) throw new Error("Settings was not rendered");
      settings.click();
      await context.inspector.updateComplete;
    };
    await toggleSettings();
    await toggleSettings();
    expect(
      metadataBodies(context).filter(
        ({ properties }) => properties.module === "action",
      ),
    ).toHaveLength(2);

    await context.selectTab("Agent");
    await context.selectTab("AG-UI Events");
    await context.selectTab("Threads");
    expect(
      metadataBodies(context).filter(
        ({ properties }) => properties.module === "action",
      ),
    ).toHaveLength(3);
    const action =
      context.inspector.shadowRoot?.querySelector<HTMLAnchorElement>(
        '[data-inspector-action-placement="locked"]',
      );
    if (!action) throw new Error("Enable Intelligence action was not rendered");
    action.dispatchEvent(new Event("click"));
    action.dispatchEvent(new Event("click"));
    await Promise.resolve();

    const enableEvents = context.telemetryBodies.filter(
      ({ event }) =>
        event === "oss.inspector.threads_intelligence_signup_clicked",
    );
    expect(enableEvents).toHaveLength(2);
    expect(enableEvents.map(({ event }) => event)).toEqual([
      "oss.inspector.threads_intelligence_signup_clicked",
      "oss.inspector.threads_intelligence_signup_clicked",
    ]);
    expect(
      context.telemetryBodies.filter(
        ({ event }) => event === TELEMETRY_EVENTS.metadataActionClicked,
      ),
    ).toEqual([]);
  } finally {
    context.teardown();
  }
});

test("runtime telemetry opt-out suppresses metadata impressions and action clicks", async () => {
  const context = await setup({
    metadataResponses: [fullMetadata()],
    telemetryDisabled: true,
  });
  try {
    await context.open();
    await context.selectTab("Threads");
    const action =
      context.inspector.shadowRoot?.querySelector<HTMLAnchorElement>(
        '[data-inspector-action-placement="threads-footer"]',
      );
    action?.dispatchEvent(new Event("click"));
    await Promise.resolve();

    expect(metadataBodies(context)).toEqual([]);
    expect(
      context.telemetryBodies.filter(
        ({ event }) => event === TELEMETRY_EVENTS.metadataActionClicked,
      ),
    ).toEqual([]);
  } finally {
    context.teardown();
  }
});

test("a stale rendered action does not emit after the Inspector disconnects", async () => {
  const context = await setup({ metadataResponses: [fullMetadata()] });
  try {
    await context.open();
    await context.selectTab("Threads");

    const action =
      context.inspector.shadowRoot?.querySelector<HTMLAnchorElement>(
        '[data-inspector-action-placement="threads-footer"]',
      );
    if (!action) throw new Error("Stale metadata action was not rendered");
    const impressionsBeforeDisconnect = metadataBodies(context).length;
    context.core.setRuntimeUrl(undefined);
    await waitFor(
      () =>
        context.core.runtimeConnectionStatus ===
        CopilotKitCoreRuntimeConnectionStatus.Disconnected,
      "the Core disconnect",
    );
    action.dispatchEvent(new Event("click"));
    await Promise.resolve();

    expect(metadataBodies(context)).toHaveLength(impressionsBeforeDisconnect);
    expect(
      context.telemetryBodies.filter(
        ({ event }) => event === TELEMETRY_EVENTS.metadataActionClicked,
      ),
    ).toEqual([]);
  } finally {
    context.teardown();
  }
});

test("detaching clears metadata impression fingerprints", async () => {
  const context = await setup({ metadataResponses: [fullMetadata()] });
  try {
    await context.open();
    expect(metadataBodies(context)).toHaveLength(2);

    context.inspector.core = null;
    await context.inspector.updateComplete;
    context.inspector.core = context.core;
    await context.inspector.updateComplete;
    await waitFor(
      () => metadataBodies(context).length === 4,
      "metadata impressions after reattach",
    );

    expect(
      metadataBodies(context).map(({ properties }) => properties.module),
    ).toEqual(["identity", "plan", "identity", "plan"]);
  } finally {
    context.teardown();
  }
});

test("telemetry delivery failures do not break metadata rendering or action clicks", async () => {
  const context = await setup({
    metadataResponses: [fullMetadata()],
    rejectTelemetry: true,
  });
  try {
    await context.open();
    await context.selectTab("Threads");
    const root = context.inspector.shadowRoot;
    const action = root?.querySelector<HTMLAnchorElement>(
      '[data-inspector-action-placement="threads-footer"]',
    );
    action?.dispatchEvent(new Event("click"));
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

    expect(root?.querySelector("[data-inspector-home]")).toBeNull();
    expect(action?.textContent).toContain("Manage Your Plan");
  } finally {
    context.teardown();
  }
});

test("metadata events never include local identity, URLs, usage, limits, counts, or thread data", async () => {
  const context = await setup({
    metadataResponses: [
      {
        ...fullMetadata(),
        usage: {
          used: 241,
          limit: { kind: "finite", value: 200 },
          expiringSoonCount: 37,
        },
      },
    ],
  });
  try {
    await context.open();
    await context.selectTab("Threads");
    const action =
      context.inspector.shadowRoot?.querySelector<HTMLAnchorElement>(
        '[data-inspector-action-placement="threads-footer"]',
      );
    expect(action?.textContent?.trim()).toBe("Upgrade Your Plan");
    action?.dispatchEvent(new Event("click"));
    await Promise.resolve();

    const events = context.telemetryBodies.filter(
      ({ event }) =>
        event === TELEMETRY_EVENTS.metadataModuleViewed ||
        event === TELEMETRY_EVENTS.metadataActionClicked,
    );
    const allowed = new Set([
      "module",
      "action_kind",
      "license_bucket",
      "usage_bucket",
      "expiry_bucket",
      "group_key",
      "leaf_key",
      "action_placement",
      "distinct_id",
      "inspector_distinct_id",
      "package_name",
      "package_version",
    ]);
    for (const event of events) {
      expect(
        Object.keys(event.properties).filter((key) => !allowed.has(key)),
      ).toEqual([]);
      expect(event.properties.module).not.toBe("usage");
    }
    const featureProperties = events.map(({ properties }) => ({
      module: properties.module,
      action_kind: properties.action_kind,
      license_bucket: properties.license_bucket,
      usage_bucket: properties.usage_bucket,
      expiry_bucket: properties.expiry_bucket,
      group_key: properties.group_key,
      leaf_key: properties.leaf_key,
      action_placement: properties.action_placement,
    }));
    expect(JSON.stringify(featureProperties)).not.toMatch(
      /Acme|Support|enterprise|cloud\.copilotkit\.ai|241|200|37|thread[_-]?id|content/i,
    );
  } finally {
    context.teardown();
  }
});
