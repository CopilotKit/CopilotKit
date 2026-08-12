import { expect, test, vi } from "vitest";

import {
  TELEMETRY_EVENTS,
  trackMetadataActionClicked,
  trackMetadataModuleViewed,
} from "../telemetry.js";
import {
  _resetTelemetryPersistenceForTesting,
  setTelemetryOptOut,
} from "../persistence.js";

type TelemetryBody = {
  event: string;
  properties: Record<string, unknown>;
};

type FetchMock = ReturnType<
  typeof vi.fn<
    (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  >
>;

function setup(): {
  fetchMock: FetchMock;
  teardown: () => void;
} {
  window.localStorage.clear();
  _resetTelemetryPersistenceForTesting();
  const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(new Response(null, { status: 204 })),
  );
  vi.stubGlobal("fetch", fetchMock);

  return {
    fetchMock,
    teardown: () => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      window.localStorage.clear();
      _resetTelemetryPersistenceForTesting();
    },
  };
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

function sentBodies(fetchMock: FetchMock): TelemetryBody[] {
  return fetchMock.mock.calls.map(([, init]) =>
    parseTelemetryBody(String(init?.body)),
  );
}

test("metadata helpers send only coarse allowlisted properties", async () => {
  const context = setup();
  try {
    const identityInput = {
      module: "identity" as const,
      license_bucket: "valid" as const,
      usage_bucket: "within_limit" as const,
      expiry_bucket: "positive" as const,
      group_key: "agents" as const,
      leaf_key: "agent-context" as const,
      organizationName: "Acme Inc.",
      projectId: "project-secret",
      usage: { used: 148, limit: 200 },
      expiryCount: 17,
      runtimeUrl: "https://runtime.private.invalid",
    };
    const actionInput = {
      action_kind: "renew" as const,
      license_bucket: "expired" as const,
      usage_bucket: "at_or_over_limit" as const,
      expiry_bucket: "zero" as const,
      group_key: "threads" as const,
      leaf_key: "threads" as const,
      action_placement: "threads_footer" as const,
      url: "https://cloud.copilotkit.ai/private",
      threadId: "thread-secret",
      rowCount: 23,
    };

    trackMetadataModuleViewed(identityInput);
    trackMetadataActionClicked(actionInput);
    await Promise.resolve();

    expect(TELEMETRY_EVENTS.metadataModuleViewed).toBe(
      "oss.inspector.metadata_module_viewed",
    );
    expect(TELEMETRY_EVENTS.metadataActionClicked).toBe(
      "oss.inspector.metadata_action_clicked",
    );
    const bodies = sentBodies(context.fetchMock);
    expect(bodies.map(({ event }) => event)).toEqual([
      "oss.inspector.metadata_module_viewed",
      "oss.inspector.metadata_action_clicked",
    ]);
    expect(bodies[0]?.properties).toMatchObject({
      module: "identity",
      license_bucket: "valid",
      usage_bucket: "within_limit",
      expiry_bucket: "positive",
      group_key: "agents",
      leaf_key: "agent-context",
    });
    expect(bodies[1]?.properties).toMatchObject({
      module: "action",
      action_kind: "renew",
      license_bucket: "expired",
      usage_bucket: "at_or_over_limit",
      expiry_bucket: "zero",
      group_key: "threads",
      leaf_key: "threads",
      action_placement: "threads_footer",
    });
    expect(Object.keys(bodies[0]!.properties).sort()).toEqual([
      "distinct_id",
      "expiry_bucket",
      "group_key",
      "inspector_distinct_id",
      "leaf_key",
      "license_bucket",
      "module",
      "package_name",
      "package_version",
      "usage_bucket",
    ]);
    expect(Object.keys(bodies[1]!.properties).sort()).toEqual([
      "action_kind",
      "action_placement",
      "distinct_id",
      "expiry_bucket",
      "group_key",
      "inspector_distinct_id",
      "leaf_key",
      "license_bucket",
      "module",
      "package_name",
      "package_version",
      "usage_bucket",
    ]);
    const featureProperties = bodies.map(({ properties }) => ({
      module: properties.module,
      action_kind: properties.action_kind,
      action_placement: properties.action_placement,
      license_bucket: properties.license_bucket,
      usage_bucket: properties.usage_bucket,
      expiry_bucket: properties.expiry_bucket,
      group_key: properties.group_key,
      leaf_key: properties.leaf_key,
    }));
    expect(JSON.stringify(featureProperties)).not.toMatch(
      /Acme|project-secret|148|200|17|runtime\.private|cloud\.copilotkit\.ai|thread-secret|23/,
    );
  } finally {
    context.teardown();
  }
});

test("metadata helpers honor local opt-out before creating a request", async () => {
  const context = setup();
  try {
    setTelemetryOptOut(true);

    trackMetadataModuleViewed({
      module: "plan",
      license_bucket: "none",
      usage_bucket: "absent",
      expiry_bucket: "unavailable",
      group_key: "agents",
      leaf_key: "capabilities",
    });
    trackMetadataActionClicked({
      action_kind: "manage_plan",
      license_bucket: "valid",
      usage_bucket: "unlimited",
      expiry_bucket: "positive",
      group_key: "threads",
      leaf_key: "threads",
      action_placement: "threads_footer",
    });
    await Promise.resolve();

    expect(context.fetchMock).not.toHaveBeenCalled();
  } finally {
    context.teardown();
  }
});

test("metadata helper delivery failures stay best-effort", async () => {
  const context = setup();
  try {
    context.fetchMock.mockRejectedValueOnce(new Error("network down"));

    expect(() =>
      trackMetadataModuleViewed({
        module: "identity",
        license_bucket: "unknown",
        usage_bucket: "unknown_limit",
        expiry_bucket: "unavailable",
        group_key: "learning",
        leaf_key: "memories",
      }),
    ).not.toThrow();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

    expect(context.fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    context.teardown();
  }
});
