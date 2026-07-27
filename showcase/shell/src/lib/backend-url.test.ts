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

  it("throws on a slug outside [a-z0-9-] (host-injection choke point)", () => {
    // Every backend URL flows through here and the slug lands in the
    // HOST of an iframe src — "." or "/" in a slug is host/path
    // injection. All registry slugs are [a-z0-9-]; anything else is a
    // contract violation, not data to be passed through.
    for (const bad of [
      "evil.example.com",
      "slug/../path",
      "$&",
      "UPPER",
      "under_score",
      "",
      "white space",
    ]) {
      expect(
        () => backendUrlFromPattern("showcase-{slug}.example.com", bad),
        `slug ${JSON.stringify(bad)} should throw`,
      ).toThrow(/invalid integration slug/);
    }
    // The registry's real slug shapes all pass.
    for (const ok of ["mastra", "langgraph-python", "ag2", "ms-agent-dotnet"]) {
      expect(() =>
        backendUrlFromPattern("showcase-{slug}.example.com", ok),
      ).not.toThrow();
    }
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
    expect(normalizeFresh("showcase-{slug}-production.up.railway.app")).toBe(
      "showcase-{slug}-production.up.railway.app",
    );
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
    expect(normalizeFresh("showcase-{slug}-staging.up.railway.app/")).toBe(
      "showcase-{slug}-staging.up.railway.app",
    );
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
    expect(normalizeFresh(" showcase-{slug}-staging.up.railway.app\t")).toBe(
      "showcase-{slug}-staging.up.railway.app",
    );
    expect(warns.some((m) => m.includes("whitespace"))).toBe(true);
  });

  it("strips internal tab/CR/LF instead of shipping raw control characters", () => {
    // The WHATWG URL parser deletes \t\r\n BEFORE parsing, so a
    // tab-bearing pattern passed the usability gate (the probe parsed
    // fine) while the RAW control character shipped in every iframe
    // src — and the old warn text claimed it would "fall back". Strip
    // them exactly the way the parser would, and warn.
    expect(normalizeFresh("showcase-{slug}\t-staging.up.railway.app")).toBe(
      "showcase-{slug}-staging.up.railway.app",
    );
    expect(normalizeFresh("show\rcase-{slug}.example\n.com")).toBe(
      "showcase-{slug}.example.com",
    );
    expect(warns.some((m) => m.includes("whitespace"))).toBe(true);
  });

  it("whitespace warn text matches the actual outcomes (host position falls back, path position ships)", () => {
    // The old text claimed internal whitespace "yields a broken backend
    // host" unconditionally — but HOST-position whitespace fails the
    // usability gate and gets the DEFAULT fallback (it never ships),
    // while PATH-position whitespace parses and genuinely ships broken.
    normalizeFresh(" showcase-{slug}.example.com ");
    const w = warns.find((m) => m.includes("whitespace"));
    expect(w).toBeDefined();
    expect(w).toContain("falls back");
    expect(w).toContain("path");
    expect(w).not.toContain("yields a broken backend host");
  });

  it("canonicalizes the authority like the override path (lowercase host, :443 elided)", () => {
    // The override path returns the parsed-normalized form (lowercase
    // host, default port elided) — the pattern path shipped the RAW
    // string into iframe srcs, leaking uppercase hosts and an explicit
    // :443. Hosts are case-insensitive and the consumer always
    // prepends https://, so this matches what the URL parser does to
    // the composed URL anyway. The {slug} placeholder is lowercase and
    // survives verbatim.
    expect(normalizeFresh("SHOWCASE-{slug}-Staging.UP.Railway.App:443")).toBe(
      "showcase-{slug}-staging.up.railway.app",
    );
    // :80 is NOT the https default — a real port must survive.
    expect(normalizeFresh("showcase-{slug}.example.com:80")).toBe(
      "showcase-{slug}.example.com:80",
    );
    // Path segments are case-SENSITIVE and stay untouched.
    expect(normalizeFresh("Backends.example.com/Base/{slug}")).toBe(
      "backends.example.com/Base/{slug}",
    );
  });

  it("names EVERY stripped scheme on a stacked-scheme pattern", () => {
    // The strip loop is once-guarded per pattern — the second
    // iteration's warn was swallowed, so only the first scheme was ever
    // named and the log understated what was removed.
    normalizeFresh("https://http://showcase-{slug}.example.com");
    const w = warns.find((m) => m.includes("scheme"));
    expect(w).toBeDefined();
    expect(w).toContain('"https://"');
    expect(w).toContain('"http://"');
  });

  it("warns once per distinct pattern value, not per call", () => {
    const pattern = "https://warn-once-{slug}.example.com/";
    normalizeFresh(pattern);
    const after = warns.length;
    expect(after).toBeGreaterThan(0);
    normalizeFresh(pattern);
    expect(warns.length).toBe(after);
  });

  it("warns when the pattern carries an internal path segment (bare-host contract)", () => {
    // `host.app/base/{slug}` silently violates the documented bare-host
    // contract — the consumer prepends https:// and concatenates routes,
    // so a base path lands in every backend URL unannounced.
    expect(normalizeFresh("backends.example.com/base/{slug}")).toBe(
      "backends.example.com/base/{slug}",
    );
    expect(warns.some((m) => m.includes("path"))).toBe(true);
  });

  it("does not fire the path warning for a path-free pattern", () => {
    normalizeFresh("showcase-{slug}-production.up.railway.app");
    expect(warns.some((m) => m.includes("path segment"))).toBe(false);
  });

  it("strips a stacked scheme to convergence (https://https://host)", () => {
    // The strip previously ran ONCE — `https://https://host` left a
    // scheme behind, and the consumer prepends https:// on top: a
    // double-prepended garbage host.
    expect(normalizeFresh("https://https://showcase-{slug}.example.com")).toBe(
      "showcase-{slug}.example.com",
    );
    expect(warns.some((m) => m.includes("scheme"))).toBe(true);
  });

  describe("degenerate patterns fall back to the default with one FATAL", () => {
    let errs: string[];
    let errSpy: MockInstance<typeof console.error>;

    beforeEach(() => {
      // The FATAL-CONFIG error (with Railway guidance) is the PROD
      // posture — in dev the same fallback logs a warn instead (see the
      // dev-mode test below). NODE_ENV is read at call time.
      vi.stubEnv("NODE_ENV", "production");
      errs = [];
      errSpy = vi
        .spyOn(console, "error")
        .mockImplementation((m: string) => void errs.push(m));
    });

    afterEach(() => {
      errSpy.mockRestore();
      vi.unstubAllEnvs();
    });

    it.each([
      ["bare scheme", "https://"],
      ["lone slash", "/"],
      ["whitespace only", "   "],
      ["internal whitespace (unparseable host)", "ho st-{slug}.example.com"],
    ])(
      "%s (%j) yields the default pattern, never an empty string",
      (_label, bad) => {
        const result = normalizeFresh(bad);
        expect(result).toBe("showcase-{slug}-production.up.railway.app");
        expect(result.length).toBeGreaterThan(0);
        expect(
          errs.some(
            (m) =>
              m.includes("FATAL-CONFIG") &&
              m.includes("SHOWCASE_BACKEND_HOST_PATTERN"),
          ),
        ).toBe(true);
      },
    );

    it("rejects a credentialed pattern (userinfo) with the default fallback + one FATAL", () => {
      // A credentialed pattern yields iframe srcs that Chromium
      // silently blocks — the integration pane just never loads, with
      // zero signal. Same userinfo rejection validateBaseUrl has
      // (runtime-config.ts).
      for (const bad of [
        "user:pass@showcase-{slug}.example.com",
        // Scheme-bearing form: the strip leaves the credentials behind.
        "https://user:pass@showcase-{slug}.example.com",
      ]) {
        const result = normalizeFresh(bad);
        expect(result, `pattern ${JSON.stringify(bad)}`).toBe(
          "showcase-{slug}-production.up.railway.app",
        );
        expect(
          errs.some(
            (m) =>
              m.includes("FATAL-CONFIG") &&
              m.includes("SHOWCASE_BACKEND_HOST_PATTERN") &&
              m.includes("userinfo"),
          ),
          `pattern ${JSON.stringify(bad)} should log a userinfo FATAL`,
        ).toBe(true);
      }
    });

    it("rejects a pattern carrying a query or fragment with the default fallback + one FATAL", () => {
      // Route concatenation appends demo routes to the composed URL —
      // `https://host?x=1` + `/route` yields `https://host?x=1/route`,
      // corrupting EVERY backend URL. Same gate class as userinfo.
      for (const [bad, component] of [
        ["showcase-{slug}.example.com?x=1", "query"],
        ["showcase-{slug}.example.com#frag", "fragment"],
      ] as const) {
        const result = normalizeFresh(bad);
        expect(result, `pattern ${JSON.stringify(bad)}`).toBe(
          "showcase-{slug}-production.up.railway.app",
        );
        expect(
          errs.some(
            (m) =>
              m.includes("FATAL-CONFIG") &&
              m.includes("SHOWCASE_BACKEND_HOST_PATTERN") &&
              m.includes(component),
          ),
          `pattern ${JSON.stringify(bad)} should log a ${component} FATAL`,
        ).toBe(true);
      }
    });

    it("rejects an empty-userinfo '@' in the authority (empty username/password evade the getters)", () => {
      // `https://@host` and `https://:@host` parse with username ===
      // "" AND password === "" — the present-but-EMPTY userinfo slips
      // the getter check, so the RAW `@`-bearing string previously
      // shipped into every iframe src.
      for (const bad of [
        "@showcase-{slug}.example.com",
        ":@showcase-{slug}.example.com",
      ]) {
        const result = normalizeFresh(bad);
        expect(result, `pattern ${JSON.stringify(bad)}`).toBe(
          "showcase-{slug}-production.up.railway.app",
        );
        expect(
          errs.some(
            (m) =>
              m.includes("FATAL-CONFIG") &&
              m.includes("SHOWCASE_BACKEND_HOST_PATTERN") &&
              m.includes("userinfo"),
          ),
          `pattern ${JSON.stringify(bad)} should log a userinfo FATAL`,
        ).toBe(true);
      }
    });

    it("rejects a bare trailing '?' / '#' (empty component evades the WHATWG getters)", () => {
      // `https://host?` parses with search === "" and `https://host#`
      // with hash === "" — a present-but-EMPTY component slips the
      // probe getters, so the RAW string (literal `?`/`#` included)
      // previously shipped, and route concatenation swallowed every
      // demo route into the query/fragment.
      for (const [bad, component] of [
        ["showcase-{slug}.example.com?", "query"],
        ["showcase-{slug}.example.com#", "fragment"],
      ] as const) {
        const result = normalizeFresh(bad);
        expect(result, `pattern ${JSON.stringify(bad)}`).toBe(
          "showcase-{slug}-production.up.railway.app",
        );
        expect(
          errs.some(
            (m) =>
              m.includes("FATAL-CONFIG") &&
              m.includes("SHOWCASE_BACKEND_HOST_PATTERN") &&
              m.includes(component),
          ),
          `pattern ${JSON.stringify(bad)} should log a ${component} FATAL`,
        ).toBe(true);
      }
    });

    it("calls out a stray scheme fragment (host literally http/https) instead of claiming unparseable", () => {
      // `https:/host` (missing one slash, so SCHEME_RE never strips
      // it) probes to `https://https:/host` — hostname "https". The
      // value DOES parse, so the old "cannot form a parseable backend
      // URL" text was a lie that hid the actual problem: a stray
      // scheme fragment in host position.
      for (const bad of ["https:/showcase-{slug}.example.com", "http"]) {
        const result = normalizeFresh(bad);
        expect(result, `pattern ${JSON.stringify(bad)}`).toBe(
          "showcase-{slug}-production.up.railway.app",
        );
        const e = errs.find(
          (m) => m.includes("FATAL-CONFIG") && m.includes(JSON.stringify(bad)),
        );
        expect(e, `pattern ${JSON.stringify(bad)} should FATAL`).toBeDefined();
        expect(e).toContain("stray scheme fragment");
        expect(e).not.toContain("cannot form a parseable");
      }
    });

    it("FATAL fires once per distinct value, not per call", () => {
      normalizeFresh("https://");
      const after = errs.length;
      expect(after).toBeGreaterThan(0);
      normalizeFresh("https://");
      expect(errs.length).toBe(after);
    });

    it("a well-formed pattern never trips the fallback or the FATAL", () => {
      expect(normalizeFresh("showcase-{slug}-staging.up.railway.app")).toBe(
        "showcase-{slug}-staging.up.railway.app",
      );
      expect(errs).toEqual([]);
    });

    it("dev-mode degenerate pattern warns (no FATAL-CONFIG / Railway guidance) and still falls back", () => {
      // Same dev-vs-prod branch validateBaseUrl has (runtime-config.ts):
      // Railway guidance is useless on a laptop — dev logs a warn, prod
      // keeps the FATAL-CONFIG error. The fallback VALUE is identical.
      vi.stubEnv("NODE_ENV", "development");
      expect(normalizeFresh("https://")).toBe(
        "showcase-{slug}-production.up.railway.app",
      );
      expect(errs).toEqual([]);
      expect(
        warns.some((m) => m.includes("SHOWCASE_BACKEND_HOST_PATTERN")),
      ).toBe(true);
      expect(warns.some((m) => m.includes("Railway"))).toBe(false);
    });
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
    expect(warns.some((m) => m.includes("NEXT_PUBLIC_LOCAL_BACKENDS"))).toBe(
      true,
    );
  });

  it("ignores non-object JSON top-levels (array / string / null) with a warning", () => {
    expect(parseFresh("[1,2]")).toEqual({});
    expect(parseFresh('"str"')).toEqual({});
    expect(parseFresh("null")).toEqual({});
    expect(warns.filter((m) => m.includes("not a JSON object")).length).toBe(3);
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

  it("memoizes the parse on the raw string (same object identity per raw)", () => {
    // Identity is the OBSERVABLE memo contract. (A global JSON.parse
    // call-count spy used to assert "called once" — fragile: ANY other
    // code touching JSON.parse during the test, including vitest
    // internals, breaks it for reasons unrelated to this module.)
    const raw = '{"mastra":"http://localhost:4111"}';
    const first = parseFresh(raw);
    const second = parseFresh(raw);
    expect(second).toEqual({ mastra: "http://localhost:4111" });
    expect(second).toBe(first);
  });

  it("does not poison the memo when the uncached parse throws mid-compute", () => {
    // The memo key (raw) was committed BEFORE the value was computed —
    // if the compute throws (console.warn is a foreign call, and a
    // logging shim CAN throw), the next call with the same raw found
    // the key already cached and returned the PREVIOUS raw's value.
    const good = parseFresh('{"mastra":"http://localhost:4111"}');
    expect(good).toEqual({ mastra: "http://localhost:4111" });
    // Make the warn inside the compute throw once ("not json" warns).
    warnSpy.mockImplementationOnce(() => {
      throw new Error("logging shim exploded");
    });
    expect(() => parseFresh("not json")).toThrow("logging shim exploded");
    // Same raw again (warn restored): must NOT return the stale good
    // map committed under the previous raw.
    expect(parseFresh("not json")).toEqual({});
  });

  it("keeps a __proto__ key as map data instead of silently dropping it", () => {
    // The accumulator was a plain `{}` — assigning `backends["__proto__"]`
    // hits the Object.prototype setter and is a silent no-op, so the
    // entry vanished with NO warning (every other rejected entry warns).
    // A null-prototype accumulator makes it an ordinary own property.
    const parsed = parseFresh(
      '{"__proto__":"http://localhost:4111","mastra":"http://localhost:4112"}',
    );
    expect(Object.keys(parsed)).toContain("__proto__");
    expect(parsed["__proto__"]).toBe("http://localhost:4111");
    expect(parsed["mastra"]).toBe("http://localhost:4112");
    // And it must land as DATA — never as prototype pollution.
    expect(({} as Record<string, unknown>).mastra).toBeUndefined();
  });

  it("returns frozen objects (the memo is shared across every caller)", () => {
    // The memoized object is handed to EVERY caller — a consumer
    // mutating its "own" map would silently change the local-backend
    // overrides for the whole process.
    const parsed = parseFresh('{"mastra":"http://localhost:4111"}');
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(() => {
      (parsed as Record<string, string>).mastra = "http://evil.example.com";
    }).toThrow(TypeError);
    // The unset/empty/invalid paths return shared objects too.
    expect(Object.isFrozen(parseFresh(undefined))).toBe(true);
    expect(Object.isFrozen(parseFresh("not json"))).toBe(true);
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

  it("trims trailing slashes from an accepted local override (host//route class)", () => {
    // The pattern path guarantees trailing-slash normalization
    // (normalizeBackendHostPattern) — an override skipping it yields
    // `host//route` when consumers concatenate demo routes.
    process.env.NEXT_PUBLIC_LOCAL_BACKENDS = JSON.stringify({
      mastra: "http://localhost:4111/",
      agno: "http://localhost:4112//",
    });
    expect(
      resolveBackendUrl("mastra", "showcase-{slug}-production.up.railway.app"),
    ).toBe("http://localhost:4111");
    expect(
      resolveBackendUrl("agno", "showcase-{slug}-production.up.railway.app"),
    ).toBe("http://localhost:4112");
  });

  it("returns the parsed-normalized form of an accepted override (host case, default port)", () => {
    // The override is already parsed for validation — returning the raw
    // string leaked un-normalized values (uppercase hosts, explicit
    // default ports) into iframe srcs, while the pattern path always
    // yields canonical hosts.
    process.env.NEXT_PUBLIC_LOCAL_BACKENDS = JSON.stringify({
      mastra: "http://LOCALHOST:4111/Api/",
      agno: "https://Proxy.Example.COM:443",
    });
    expect(
      resolveBackendUrl("mastra", "showcase-{slug}-production.up.railway.app"),
    ).toBe("http://localhost:4111/Api");
    expect(
      resolveBackendUrl("agno", "showcase-{slug}-production.up.railway.app"),
    ).toBe("https://proxy.example.com");
  });

  it("warns about and ignores an empty-string local override instead of yielding an empty URL", async () => {
    // A `??` fallback treated `{"mastra": ""}` as a valid override and
    // returned "" — which renders an iframe src of just the route. The
    // emptiness skip then happened BEFORE the warn block, so the dead
    // override was ignored with ZERO signal — the one bad-override
    // class that never warned. Fresh module instance: the warn-once
    // latch is module state.
    vi.resetModules();
    const { resolveBackendUrl: resolveFresh } = await import("./backend-url");
    const warns: string[] = [];
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation((m: string) => void warns.push(m));
    try {
      process.env.NEXT_PUBLIC_LOCAL_BACKENDS = JSON.stringify({ mastra: "" });
      expect(
        resolveFresh("mastra", "showcase-{slug}-production.up.railway.app"),
      ).toBe("https://showcase-mastra-production.up.railway.app");
      expect(
        warns.some((m) => m.includes("mastra") && m.includes("empty")),
        "ignoring an empty override should warn, naming the slug",
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("warns and ignores a local override with a non-http(s) scheme (iframe-src injection guard)", async () => {
    // `javascript://...` and `ftp://...` are scheme-bearing AND
    // parseable, so they previously passed straight into iframe srcs.
    // Fresh module instance: the warn-once latch is module state.
    vi.resetModules();
    const { resolveBackendUrl: resolveFresh } = await import("./backend-url");
    const warns: string[] = [];
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation((m: string) => void warns.push(m));
    try {
      process.env.NEXT_PUBLIC_LOCAL_BACKENDS = JSON.stringify({
        mastra: "javascript://alert(1)",
        agno: "ftp://files.example.com",
        crewai: "http://localhost:4112",
      });
      expect(
        resolveFresh("mastra", "showcase-{slug}-production.up.railway.app"),
      ).toBe("https://showcase-mastra-production.up.railway.app");
      expect(
        resolveFresh("agno", "showcase-{slug}-production.up.railway.app"),
      ).toBe("https://showcase-agno-production.up.railway.app");
      // http(s) overrides still win.
      expect(
        resolveFresh("crewai", "showcase-{slug}-production.up.railway.app"),
      ).toBe("http://localhost:4112");
      expect(warns.some((m) => m.includes("mastra"))).toBe(true);
      expect(warns.some((m) => m.includes("agno"))).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("warns and ignores a local override carrying userinfo, query, or fragment components", async () => {
    // An override lands verbatim in iframe srcs and route concatenation:
    // userinfo gets silently blocked by Chromium (same rejection the
    // pattern path has), and a query/fragment corrupts every composed
    // URL (`http://host?x=1` + `/route` → `http://host?x=1/route`).
    // Fresh module instance: the warn-once latch is module state.
    vi.resetModules();
    const { resolveBackendUrl: resolveFresh } = await import("./backend-url");
    const warns: string[] = [];
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation((m: string) => void warns.push(m));
    try {
      process.env.NEXT_PUBLIC_LOCAL_BACKENDS = JSON.stringify({
        mastra: "http://user:pass@localhost:4111",
        agno: "http://localhost:4112?x=1",
        crewai: "http://localhost:4113#frag",
        adk: "http://localhost:4114",
      });
      for (const slug of ["mastra", "agno", "crewai"]) {
        expect(
          resolveFresh(slug, "showcase-{slug}-production.up.railway.app"),
          `override for "${slug}" should be rejected`,
        ).toBe(`https://showcase-${slug}-production.up.railway.app`);
        expect(
          warns.some((m) => m.includes(slug)),
          `rejecting "${slug}" should warn`,
        ).toBe(true);
      }
      // A clean http(s) override still wins.
      expect(
        resolveFresh("adk", "showcase-{slug}-production.up.railway.app"),
      ).toBe("http://localhost:4114");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("trims a whitespace-padded local override before validating it (paste artifact)", async () => {
    // The pattern path trims paste artifacts (normalizeBackendHostPattern)
    // — the override path rejected " http://localhost:4111" outright,
    // because the SCHEME_RE anchor fails on the leading space even
    // though the URL parser accepts the value. Align the philosophy:
    // trim first, then validate. Whitespace-ONLY collapses to the
    // empty-override warn path.
    vi.resetModules();
    const { resolveBackendUrl: resolveFresh } = await import("./backend-url");
    const warns: string[] = [];
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation((m: string) => void warns.push(m));
    try {
      process.env.NEXT_PUBLIC_LOCAL_BACKENDS = JSON.stringify({
        mastra: " http://localhost:4111\t",
        agno: "   ",
      });
      expect(
        resolveFresh("mastra", "showcase-{slug}-production.up.railway.app"),
      ).toBe("http://localhost:4111");
      expect(warns.some((m) => m.includes("mastra"))).toBe(false);
      expect(
        resolveFresh("agno", "showcase-{slug}-production.up.railway.app"),
      ).toBe("https://showcase-agno-production.up.railway.app");
      expect(warns.some((m) => m.includes("agno") && m.includes("empty"))).toBe(
        true,
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("explains WHY a slashless-but-parseable override (http:localhost:4111) is rejected", async () => {
    // `http:localhost:4111` IS parseable (special schemes tolerate
    // missing slashes — it parses to http://localhost:4111/), so the
    // old "is not a plain parseable http(s) base URL" warn sent the
    // developer chasing a parse problem that doesn't exist. The real
    // rejection is the explicit `scheme://` requirement.
    vi.resetModules();
    const { resolveBackendUrl: resolveFresh } = await import("./backend-url");
    const warns: string[] = [];
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation((m: string) => void warns.push(m));
    try {
      process.env.NEXT_PUBLIC_LOCAL_BACKENDS = JSON.stringify({
        mastra: "http:localhost:4111",
      });
      expect(
        resolveFresh("mastra", "showcase-{slug}-production.up.railway.app"),
      ).toBe("https://showcase-mastra-production.up.railway.app");
      const w = warns.find((m) => m.includes("mastra"));
      expect(w).toBeDefined();
      expect(w).toContain("://");
      expect(w).not.toContain("not a plain parseable");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("warns and ignores a local override that is not a scheme-bearing parseable URL", async () => {
    // `{"mastra": "localhost:4111"}` (no scheme) or outright garbage
    // would land verbatim in an iframe src — fall back to the pattern
    // instead, with a warn.
    //
    // Fresh module instance: the warn-once latch is module state, so
    // asserting on the STATIC import is not retry-safe (a --retry rerun
    // finds the latch already consumed) — same discipline as the
    // sibling describes.
    vi.resetModules();
    const { resolveBackendUrl: resolveFresh } = await import("./backend-url");
    const warns: string[] = [];
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation((m: string) => void warns.push(m));
    try {
      process.env.NEXT_PUBLIC_LOCAL_BACKENDS = JSON.stringify({
        mastra: "localhost:4111",
        agno: "http://exa mple/",
        crewai: "http://localhost:4112",
      });
      expect(
        resolveFresh("mastra", "showcase-{slug}-production.up.railway.app"),
      ).toBe("https://showcase-mastra-production.up.railway.app");
      expect(
        resolveFresh("agno", "showcase-{slug}-production.up.railway.app"),
      ).toBe("https://showcase-agno-production.up.railway.app");
      // A well-formed override still wins.
      expect(
        resolveFresh("crewai", "showcase-{slug}-production.up.railway.app"),
      ).toBe("http://localhost:4112");
      expect(warns.some((m) => m.includes("mastra"))).toBe(true);
      expect(warns.some((m) => m.includes("agno"))).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
