import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import {
  _resetRuntimeTelemetryDisclosureForTesting,
  logRuntimeTelemetryDisclosure,
} from "../telemetry-disclosure";

let consoleInfoSpy: MockInstance<typeof console.info>;
const originalEnv = { ...process.env };

beforeEach(() => {
  _resetRuntimeTelemetryDisclosureForTesting();
  consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  // Clear opt-out env vars so the disclosure can fire by default.
  delete process.env.COPILOTKIT_TELEMETRY_DISABLED;
  delete process.env.DO_NOT_TRACK;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

describe("logRuntimeTelemetryDisclosure", () => {
  it("logs once per process", () => {
    logRuntimeTelemetryDisclosure();
    logRuntimeTelemetryDisclosure();
    logRuntimeTelemetryDisclosure();

    expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
    const [message] = consoleInfoSpy.mock.calls[0]!;
    expect(message).toMatch(/anonymous telemetry/i);
    expect(message).toMatch(/COPILOTKIT_TELEMETRY_DISABLED/);
  });

  it("does not log when COPILOTKIT_TELEMETRY_DISABLED is set", () => {
    process.env.COPILOTKIT_TELEMETRY_DISABLED = "true";
    logRuntimeTelemetryDisclosure();
    expect(consoleInfoSpy).not.toHaveBeenCalled();
  });

  it("does not log when DO_NOT_TRACK is set", () => {
    process.env.DO_NOT_TRACK = "1";
    logRuntimeTelemetryDisclosure();
    expect(consoleInfoSpy).not.toHaveBeenCalled();
  });
});
