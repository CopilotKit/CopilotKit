import { expect, test, vi } from "vitest";

const telemetryEnvironment = vi.hoisted(() => {
  const previousTelemetryId = process.env.CPK_TELEMETRY_ID;
  process.env.CPK_TELEMETRY_ID = "standalone-runtime-telemetry-id";

  return {
    restore() {
      if (previousTelemetryId === undefined) {
        delete process.env.CPK_TELEMETRY_ID;
      } else {
        process.env.CPK_TELEMETRY_ID = previousTelemetryId;
      }
    },
  };
});

import {
  CANONICAL_INSPECTOR_TELEMETRY_REQUESTS,
  captureInspectorTelemetryTransportContract,
} from "./telemetry-transport-contract.js";

test("Inspector telemetry matches canonical direct-sink requests when CPK_TELEMETRY_ID is present at import", async () => {
  try {
    expect(process.env.CPK_TELEMETRY_ID).toBe(
      "standalone-runtime-telemetry-id",
    );
    const requests = await captureInspectorTelemetryTransportContract();

    expect(requests).toEqual(CANONICAL_INSPECTOR_TELEMETRY_REQUESTS);
  } finally {
    telemetryEnvironment.restore();
  }
});
