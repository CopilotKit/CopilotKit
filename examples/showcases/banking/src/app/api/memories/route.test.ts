import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/memories", () => {
  it("404s when Glass Engine is unavailable (public-host default)", async () => {
    vi.stubEnv("GLASS_ENGINE_AVAILABLE", "");
    // Even with Intelligence configured, an unavailable deployment exposes nothing.
    vi.stubEnv("INTELLIGENCE_API_URL", "http://localhost:7050");
    vi.stubEnv("INTELLIGENCE_GATEWAY_WS_URL", "ws://localhost:7053");
    vi.stubEnv("INTELLIGENCE_API_KEY", "cpk_x");
    const res = await GET(new Request("http://localhost:3000/api/memories"));
    expect(res.status).toBe(404);
  });

  it("returns 503 intelligence_disabled when available but in OSS mode", async () => {
    vi.stubEnv("GLASS_ENGINE_AVAILABLE", "true");
    vi.stubEnv("INTELLIGENCE_API_URL", "");
    vi.stubEnv("INTELLIGENCE_GATEWAY_WS_URL", "");
    vi.stubEnv("INTELLIGENCE_API_KEY", "");
    const res = await GET(new Request("http://localhost:3000/api/memories"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "intelligence_disabled" });
  });
});
