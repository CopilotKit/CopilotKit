import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import { describe, expect, it } from "vitest";

import { getCoreStatusSummary } from "./core-bridge.js";

describe("getCoreStatusSummary", () => {
  it.each([
    {
      runtimeStatus: CopilotKitCoreRuntimeConnectionStatus.Connected,
      expected: ["Connected", "connected"],
    },
    {
      runtimeStatus: CopilotKitCoreRuntimeConnectionStatus.Connecting,
      expected: ["Connecting", "connecting"],
    },
    {
      runtimeStatus: CopilotKitCoreRuntimeConnectionStatus.Disconnected,
      expected: ["Disconnected", "disconnected"],
    },
  ] as const)(
    "maps $runtimeStatus to $expected.1",
    ({ runtimeStatus, expected }) => {
      const summary = getCoreStatusSummary({ hasCore: true, runtimeStatus });

      expect([summary.label, summary.state]).toEqual(expected);
    },
  );

  it("reports an unattached core before considering runtime status", () => {
    expect(
      getCoreStatusSummary({
        hasCore: false,
        runtimeStatus: CopilotKitCoreRuntimeConnectionStatus.Error,
      }).state,
    ).toBe("unavailable");
  });

  it("uses the latest runtime error message", () => {
    expect(
      getCoreStatusSummary({
        hasCore: true,
        runtimeStatus: CopilotKitCoreRuntimeConnectionStatus.Error,
        lastErrorMessage: "Connection refused",
      }),
    ).toMatchObject({
      label: "Runtime error",
      state: "error",
      description: "Connection refused",
    });
  });
});
