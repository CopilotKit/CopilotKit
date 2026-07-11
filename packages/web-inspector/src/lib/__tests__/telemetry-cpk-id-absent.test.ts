import { expect, test, vi } from "vitest";

const telemetryEnvironment = vi.hoisted(() => {
  const previousTelemetryId = process.env.CPK_TELEMETRY_ID;
  delete process.env.CPK_TELEMETRY_ID;

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

test("Inspector telemetry keeps its browser identity when CPK_TELEMETRY_ID is absent at import", async () => {
  try {
    expect(process.env.CPK_TELEMETRY_ID).toBeUndefined();
    await expectInspectorTelemetryTransportContract();
  } finally {
    telemetryEnvironment.restore();
  }
});
