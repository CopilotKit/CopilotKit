import { afterEach, describe, expect, it, vi } from "vitest";
import { presenterResetEnabled } from "./presenter";

afterEach(() => vi.unstubAllEnvs());

describe("presenterResetEnabled", () => {
  it("is false when the env var is unset", () => {
    vi.stubEnv("PRESENTER_RESET_ENABLED", "");
    expect(presenterResetEnabled()).toBe(false);
  });

  it("is false for any value other than 'true'", () => {
    vi.stubEnv("PRESENTER_RESET_ENABLED", "1");
    expect(presenterResetEnabled()).toBe(false);
  });

  it("is true only for the exact string 'true'", () => {
    vi.stubEnv("PRESENTER_RESET_ENABLED", "true");
    expect(presenterResetEnabled()).toBe(true);
  });
});
