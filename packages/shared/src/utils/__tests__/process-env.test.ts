import { afterEach, describe, expect, it, vi } from "vitest";
import { processEnv } from "../process-env";

describe("processEnv", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("reads the live process environment", () => {
    vi.stubEnv("CPK_PROCESS_ENV_TEST", "first");
    expect(processEnv().CPK_PROCESS_ENV_TEST).toBe("first");
    vi.stubEnv("CPK_PROCESS_ENV_TEST", "second");
    expect(processEnv().CPK_PROCESS_ENV_TEST).toBe("second");
  });

  // Cloudflare Workers without nodejs_compat define no `process`.
  it("returns an empty environment where there is no process", () => {
    vi.stubGlobal("process", undefined);
    expect(processEnv()).toEqual({});
  });
});
