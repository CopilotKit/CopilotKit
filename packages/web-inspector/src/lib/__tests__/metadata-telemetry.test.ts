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

function sentBodies(fetchMock: FetchMock): TelemetryBody[] {
  return fetchMock.mock.calls.map(([, init]) =>
    JSON.parse(String(init?.body)),
  ) as TelemetryBody[];
}

test("metadata helpers send only coarse allowlisted properties", async () => {
  const context = setup();
  try {
    const identityInput = {
      module: "identity" as const,
      license_bucket: "valid" as const,
      organizationName: "Acme Inc.",
      projectId: "project-secret",
      usage: { used: 148, limit: 200 },
    };
    const actionInput = {
      action_kind: "renew" as const,
      license_bucket: "expired" as const,
      url: "https://cloud.copilotkit.ai/private",
      threadId: "thread-secret",
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
    });
    expect(bodies[1]?.properties).toMatchObject({
      module: "action",
      action_kind: "renew",
      license_bucket: "expired",
    });
    const allowed = new Set([
      "module",
      "action_kind",
      "license_bucket",
      "distinct_id",
      "inspector_distinct_id",
      "package_name",
      "package_version",
    ]);
    for (const body of bodies) {
      expect(
        Object.keys(body.properties).filter((key) => !allowed.has(key)),
      ).toEqual([]);
    }
    const featureProperties = bodies.map(({ properties }) => ({
      module: properties.module,
      action_kind: properties.action_kind,
      license_bucket: properties.license_bucket,
    }));
    expect(JSON.stringify(featureProperties)).not.toMatch(
      /Acme|project-secret|148|200|cloud\.copilotkit\.ai|thread-secret/,
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
    });
    trackMetadataActionClicked({
      action_kind: "manage_plan",
      license_bucket: "valid",
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
      }),
    ).not.toThrow();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

    expect(context.fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    context.teardown();
  }
});
