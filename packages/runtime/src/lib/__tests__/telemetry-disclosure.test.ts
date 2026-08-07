import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

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

  it("logs once even when the module is re-evaluated", async () => {
    // Next.js dev compiles each API route in its own module context, so the
    // module-level once-guard is reborn per route and the disclosure used to
    // re-fire on every route compile. The guard must survive module
    // re-evaluation within a single process.
    vi.resetModules();
    const first = await import("../telemetry-disclosure");
    first.logRuntimeTelemetryDisclosure();

    vi.resetModules();
    const second = await import("../telemetry-disclosure");
    second.logRuntimeTelemetryDisclosure();

    expect(second).not.toBe(first);
    expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
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
