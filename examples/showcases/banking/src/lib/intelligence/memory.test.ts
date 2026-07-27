import { afterEach, describe, expect, it, vi } from "vitest";
import { intelligenceEnabled, parseRecallResponse } from "./memory";

afterEach(() => vi.unstubAllEnvs());

describe("parseRecallResponse", () => {
  it("extracts the memories array from a REST recall body", () => {
    const mems = [
      {
        id: "m1",
        kind: "operational",
        scope: "project",
        content: "x",
        sourceThreadIds: [],
      },
    ];
    expect(parseRecallResponse({ memories: mems })).toEqual(mems);
  });

  it("returns [] when the body has no memories array", () => {
    expect(parseRecallResponse({})).toEqual([]);
    expect(parseRecallResponse(null)).toEqual([]);
    expect(parseRecallResponse("nope")).toEqual([]);
  });
});

describe("intelligenceEnabled", () => {
  it("is false when any INTELLIGENCE_* var is missing", () => {
    vi.stubEnv("INTELLIGENCE_API_URL", "");
    vi.stubEnv("INTELLIGENCE_GATEWAY_WS_URL", "");
    vi.stubEnv("INTELLIGENCE_API_KEY", "");
    expect(intelligenceEnabled()).toBe(false);
  });

  it("is true when all three are set", () => {
    vi.stubEnv("INTELLIGENCE_API_URL", "http://localhost:7050");
    vi.stubEnv("INTELLIGENCE_GATEWAY_WS_URL", "ws://localhost:7053");
    vi.stubEnv("INTELLIGENCE_API_KEY", "cpk_x");
    expect(intelligenceEnabled()).toBe(true);
  });
});
