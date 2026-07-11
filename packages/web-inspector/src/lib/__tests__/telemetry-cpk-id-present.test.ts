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

import { expectInspectorTelemetryTransportContract } from "./telemetry-transport-contract.js";

test("Inspector telemetry keeps its browser identity when CPK_TELEMETRY_ID is present at import", async () => {
  try {
    expect(process.env.CPK_TELEMETRY_ID).toBe(
      "standalone-runtime-telemetry-id",
    );
    await expectInspectorTelemetryTransportContract();
  } finally {
    telemetryEnvironment.restore();
  }
});
