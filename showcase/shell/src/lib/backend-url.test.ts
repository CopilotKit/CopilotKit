import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backendUrlFromPattern,
  normalizeBackendHostPattern,
  parseLocalBackends,
  resolveBackendUrl,
} from "./backend-url";

describe("backendUrlFromPattern", () => {
  it("substitutes {slug} into the host pattern and prepends https://", () => {
    expect(
      backendUrlFromPattern(
        "showcase-{slug}-production.up.railway.app",
        "mastra",
      ),
    ).toBe("https://showcase-mastra-production.up.railway.app");
  });

  it("matches the registry-baked prod URL for the default pattern (byte parity)", () => {
    // generate-registry.ts synthesizes backend_url with the exact same
    // pattern + https:// prefix. The runtime derivation MUST reproduce
    // it byte-for-byte so prod behavior is unchanged with env unset.
    expect(
      backendUrlFromPattern(
        "showcase-{slug}-production.up.railway.app",
        "langgraph-python",
      ),
    ).toBe("https://showcase-langgraph-python-production.up.railway.app");
  });

  it("supports a staging-style pattern override", () => {
    expect(
      backendUrlFromPattern("showcase-{slug}-staging.up.railway.app", "agno"),
    ).toBe("https://showcase-agno-staging.up.railway.app");
  });

  it("substitutes EVERY {slug} occurrence, not just the first", () => {
    expect(
      backendUrlFromPattern("{slug}.demos.example.com/{slug}", "mastra"),
    ).toBe("https://mastra.demos.example.com/mastra");
  });
});

describe("normalizeBackendHostPattern", () => {
  let warns: string[];
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warns = [];
    warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation((m: string) => warns.push(m));
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("passes a well-formed pattern through untouched, no warning", () => {
    expect(
      normalizeBackendHostPattern("showcase-{slug}-production.up.railway.app"),
    ).toBe("showcase-{slug}-production.up.railway.app");
    expect(warns).toEqual([]);
  });

  it("strips a leading scheme (consumer prepends https://) and warns", () => {
    // A scheme-bearing env value would otherwise yield `https://https://…`.
    expect(
      normalizeBackendHostPattern(
        "https://showcase-{slug}-staging.up.railway.app",
      ),
    ).toBe("showcase-{slug}-staging.up.railway.app");
    expect(warns.some((m) => m.includes("scheme"))).toBe(true);
  });

  it("trims trailing slashes (route concat would yield //route) and warns", () => {
    expect(
      normalizeBackendHostPattern("showcase-{slug}-staging.up.railway.app/"),
    ).toBe("showcase-{slug}-staging.up.railway.app");
    expect(warns.some((m) => m.includes("trailing"))).toBe(true);
  });

  it("warns when the pattern lacks {slug} (all integrations → one host)", () => {
    expect(normalizeBackendHostPattern("showcase-static.example.com")).toBe(
      "showcase-static.example.com",
    );
    expect(warns.some((m) => m.includes("{slug}"))).toBe(true);
  });

  it("warns once per distinct pattern value, not per call", () => {
    const pattern = "https://warn-once-{slug}.example.com/";
    normalizeBackendHostPattern(pattern);
    const after = warns.length;
    expect(after).toBeGreaterThan(0);
    normalizeBackendHostPattern(pattern);
    expect(warns.length).toBe(after);
  });
});

describe("parseLocalBackends", () => {
  let warns: string[];
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warns = [];
    warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation((m: string) => warns.push(m));
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("returns {} for undefined / empty / invalid JSON", () => {
    expect(parseLocalBackends(undefined)).toEqual({});
    expect(parseLocalBackends("")).toEqual({});
    expect(parseLocalBackends("not json")).toEqual({});
  });

  it("names the env var in a warning when the JSON is unparseable", () => {
    expect(parseLocalBackends("not json")).toEqual({});
    expect(
      warns.some((m) => m.includes("NEXT_PUBLIC_LOCAL_BACKENDS")),
    ).toBe(true);
  });

  it("parses a slug->url map", () => {
    expect(parseLocalBackends('{"mastra":"http://localhost:4111"}')).toEqual({
      mastra: "http://localhost:4111",
    });
    expect(warns).toEqual([]);
  });

  it("skips (and warns about) non-string values instead of passing them through", () => {
    expect(
      parseLocalBackends(
        '{"mastra":"http://localhost:4111","agno":4111,"crewai":null}',
      ),
    ).toEqual({ mastra: "http://localhost:4111" });
    expect(warns.some((m) => m.includes("agno"))).toBe(true);
    expect(warns.some((m) => m.includes("crewai"))).toBe(true);
  });
});

describe("resolveBackendUrl", () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_LOCAL_BACKENDS;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_LOCAL_BACKENDS;
  });

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.NEXT_PUBLIC_LOCAL_BACKENDS;
    } else {
      process.env.NEXT_PUBLIC_LOCAL_BACKENDS = ORIGINAL;
    }
  });

  it("derives from the pattern when no local backend override exists", () => {
    expect(
      resolveBackendUrl("mastra", "showcase-{slug}-production.up.railway.app"),
    ).toBe("https://showcase-mastra-production.up.railway.app");
  });

  it("prefers NEXT_PUBLIC_LOCAL_BACKENDS in local dev (behavior preserved)", () => {
    process.env.NEXT_PUBLIC_LOCAL_BACKENDS = JSON.stringify({
      mastra: "http://localhost:4111",
    });
    expect(
      resolveBackendUrl("mastra", "showcase-{slug}-production.up.railway.app"),
    ).toBe("http://localhost:4111");
    // Slugs absent from the local map still derive from the pattern.
    expect(
      resolveBackendUrl("agno", "showcase-{slug}-production.up.railway.app"),
    ).toBe("https://showcase-agno-production.up.railway.app");
  });

  it("ignores an empty-string local override instead of yielding an empty URL", () => {
    // A `??` fallback treated `{"mastra": ""}` as a valid override and
    // returned "" — which renders an iframe src of just the route.
    process.env.NEXT_PUBLIC_LOCAL_BACKENDS = JSON.stringify({ mastra: "" });
    expect(
      resolveBackendUrl("mastra", "showcase-{slug}-production.up.railway.app"),
    ).toBe("https://showcase-mastra-production.up.railway.app");
  });
});
