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

  it("inserts the slug literally even when it contains $-substitution patterns", () => {
    // String replacement treats "$&" as "the matched text" — a slug of
    // "$&" would re-insert "{slug}" instead of the slug itself.
    expect(
      backendUrlFromPattern("showcase-{slug}.example.com", "$&"),
    ).toBe("https://showcase-$&.example.com");
  });
});

describe("normalizeBackendHostPattern", () => {
  let warns: string[];
  let warnSpy: MockInstance<typeof console.warn>;
  let normalizeFresh: typeof normalizeBackendHostPattern;

  beforeEach(async () => {
    // The warn-once guard is module state, which makes warning
    // assertions non-idempotent under vitest --retry — use a fresh
    // module instance per test.
    vi.resetModules();
    normalizeFresh = (await import("./backend-url"))
      .normalizeBackendHostPattern;
    warns = [];
    warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation((m: string) => void warns.push(m));
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("passes a well-formed pattern through untouched, no warning", () => {
    expect(
      normalizeFresh("showcase-{slug}-production.up.railway.app"),
    ).toBe("showcase-{slug}-production.up.railway.app");
    expect(warns).toEqual([]);
  });

  it("strips a leading scheme (consumer prepends https://) and warns", () => {
    // A scheme-bearing env value would otherwise yield `https://https://…`.
    expect(
      normalizeFresh("https://showcase-{slug}-staging.up.railway.app"),
    ).toBe("showcase-{slug}-staging.up.railway.app");
    expect(warns.some((m) => m.includes("scheme"))).toBe(true);
  });

  it("trims trailing slashes (route concat would yield //route) and warns", () => {
    expect(
      normalizeFresh("showcase-{slug}-staging.up.railway.app/"),
    ).toBe("showcase-{slug}-staging.up.railway.app");
    expect(warns.some((m) => m.includes("trailing"))).toBe(true);
  });

  it("warns when the pattern lacks {slug} (all integrations → one host)", () => {
    expect(normalizeFresh("showcase-static.example.com")).toBe(
      "showcase-static.example.com",
    );
    expect(warns.some((m) => m.includes("{slug}"))).toBe(true);
  });

  it("trims leading/trailing whitespace (paste artifact) and warns", () => {
    // Previously the ONE misconfig class with zero warning — a pasted
    // ` host` survives into `https:// host` iframe srcs.
    expect(
      normalizeFresh(" showcase-{slug}-staging.up.railway.app\t"),
    ).toBe("showcase-{slug}-staging.up.railway.app");
    expect(warns.some((m) => m.includes("whitespace"))).toBe(true);
  });

  it("warns once per distinct pattern value, not per call", () => {
    const pattern = "https://warn-once-{slug}.example.com/";
    normalizeFresh(pattern);
    const after = warns.length;
    expect(after).toBeGreaterThan(0);
    normalizeFresh(pattern);
    expect(warns.length).toBe(after);
  });
});

describe("parseLocalBackends", () => {
  let warns: string[];
  let warnSpy: MockInstance<typeof console.warn>;
  let parseFresh: typeof parseLocalBackends;

  beforeEach(async () => {
    // Warn-once + memo module state: a fresh module instance per test
    // keeps the warning assertions order-independent and retry-safe.
    vi.resetModules();
    parseFresh = (await import("./backend-url")).parseLocalBackends;
    warns = [];
    warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation((m: string) => void warns.push(m));
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("returns {} for undefined / empty / invalid JSON", () => {
    expect(parseFresh(undefined)).toEqual({});
    expect(parseFresh("")).toEqual({});
    expect(parseFresh("not json")).toEqual({});
  });

  it("names the env var in a warning when the JSON is unparseable", () => {
    expect(parseFresh("not json")).toEqual({});
    expect(
      warns.some((m) => m.includes("NEXT_PUBLIC_LOCAL_BACKENDS")),
    ).toBe(true);
  });

  it("ignores non-object JSON top-levels (array / string / null) with a warning", () => {
    expect(parseFresh("[1,2]")).toEqual({});
    expect(parseFresh('"str"')).toEqual({});
    expect(parseFresh("null")).toEqual({});
    expect(warns.filter((m) => m.includes("not a JSON object")).length).toBe(
      3,
    );
  });

  it("parses a slug->url map", () => {
    expect(parseFresh('{"mastra":"http://localhost:4111"}')).toEqual({
      mastra: "http://localhost:4111",
    });
    expect(warns).toEqual([]);
  });

  it("skips (and warns about) non-string values instead of passing them through", () => {
    expect(
      parseFresh(
        '{"mastra":"http://localhost:4111","agno":4111,"crewai":null}',
      ),
    ).toEqual({ mastra: "http://localhost:4111" });
    expect(warns.some((m) => m.includes("agno"))).toBe(true);
    expect(warns.some((m) => m.includes("crewai"))).toBe(true);
  });

  it("warns once per distinct raw value, not per call", () => {
    parseFresh("not json");
    parseFresh("not json");
    expect(warns.filter((m) => m.includes("not valid JSON")).length).toBe(1);
  });

  it("memoizes the parse on the raw string (no per-call JSON.parse)", () => {
    const parseSpy = vi.spyOn(JSON, "parse");
    try {
      const raw = '{"mastra":"http://localhost:4111"}';
      const first = parseFresh(raw);
      const second = parseFresh(raw);
      expect(second).toEqual({ mastra: "http://localhost:4111" });
      expect(second).toBe(first);
      expect(parseSpy).toHaveBeenCalledTimes(1);
    } finally {
      parseSpy.mockRestore();
    }
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
