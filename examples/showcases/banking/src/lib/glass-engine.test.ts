import { afterEach, describe, expect, it, vi } from "vitest";
import { glassEngineAvailable } from "./glass-engine";

afterEach(() => vi.unstubAllEnvs());

describe("glassEngineAvailable", () => {
  it("is false when the flag is unset (public-host default)", () => {
    vi.stubEnv("GLASS_ENGINE_AVAILABLE", "");
    expect(glassEngineAvailable()).toBe(false);
  });

  it('is true only for the exact string "true"', () => {
    vi.stubEnv("GLASS_ENGINE_AVAILABLE", "true");
    expect(glassEngineAvailable()).toBe(true);
  });

  it("treats any other value as off (no accidental enable)", () => {
    vi.stubEnv("GLASS_ENGINE_AVAILABLE", "1");
    expect(glassEngineAvailable()).toBe(false);
    vi.stubEnv("GLASS_ENGINE_AVAILABLE", "yes");
    expect(glassEngineAvailable()).toBe(false);
  });
});
