import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub next/cache.unstable_noStore — vitest runs outside Next's runtime
// so the real implementation throws ("called outside a Server
// Component"). The function is a no-op for our purposes (it tells Next
// not to cache; in a unit test there is no cache to opt out of).
vi.mock("next/cache", () => ({
  unstable_noStore: () => {},
}));

import { getRuntimeConfig } from "./runtime-config";

describe("server getRuntimeConfig (shell)", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    for (const k of [
      "BASE_URL",
      "POSTHOG_HOST",
      "POSTHOG_KEY",
      "DOCS_HOST",
      "SHOWCASE_BACKEND_HOST_PATTERN",
      "NEXT_PUBLIC_BASE_URL",
      "NEXT_PUBLIC_POSTHOG_HOST",
      "NEXT_PUBLIC_POSTHOG_KEY",
      "NEXT_PUBLIC_DOCS_HOST",
      "NEXT_PUBLIC_SHOWCASE_BACKEND_HOST_PATTERN",
      "NODE_ENV",
    ]) {
      delete (process.env as Record<string, string | undefined>)[k];
    }
  });

  afterEach(() => {
    // Full restore, not just value restore: Object.assign alone cannot
    // DELETE keys a test added (e.g. DOCS_HOST set by a test but absent
    // from the snapshot), which poisons other test FILES under vitest
    // worker reuse. Drop added keys first, then restore values.
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENV)) {
        delete (process.env as Record<string, string | undefined>)[key];
      }
    }
    Object.assign(process.env, ORIGINAL_ENV);
  });

  it("returns env values when all are set (production)", () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://showcase.copilotkit.ai";
    process.env.POSTHOG_HOST = "https://eu.i.posthog.com";
    expect(getRuntimeConfig()).toEqual({
      baseUrl: "https://showcase.copilotkit.ai",
      posthogHost: "https://eu.i.posthog.com",
      // Defaults preserved when the new env vars are unset — prod
      // requires NO env change.
      backendHostPattern: "showcase-{slug}-production.up.railway.app",
      docsHost: "https://docs.showcase.copilotkit.ai",
    });
  });

  it("backendHostPattern/docsHost default to prod values when unset (both envs, no FATAL log)", async () => {
    for (const nodeEnv of ["production", "development"]) {
      (process.env as Record<string, string>).NODE_ENV = nodeEnv;
      process.env.BASE_URL = "https://showcase.copilotkit.ai";
      // The no-FATAL assertions below are about ABSENCE — on the static
      // module instance they can pass vacuously when a prior test
      // already consumed the once-guard for these keys. Fresh module so
      // a log would actually fire if the code were wrong.
      vi.resetModules();
      const { getRuntimeConfig: freshGet } = await import("./runtime-config");
      const errs: string[] = [];
      const spy = vi.spyOn(console, "error").mockImplementation((m: string) => {
        errs.push(m);
      });
      // try/finally so a failing assertion can't leak the spy into
      // other tests (matches every other spy in this file).
      let cfg: ReturnType<typeof freshGet>;
      try {
        cfg = freshGet();
      } finally {
        spy.mockRestore();
      }
      expect(cfg.backendHostPattern).toBe(
        "showcase-{slug}-production.up.railway.app",
      );
      expect(cfg.docsHost).toBe("https://docs.showcase.copilotkit.ai");
      // These have legitimate prod defaults — never FATAL-CONFIG noise.
      expect(errs.some((m) => m.includes("DOCS_HOST"))).toBe(false);
      expect(
        errs.some((m) => m.includes("SHOWCASE_BACKEND_HOST_PATTERN")),
      ).toBe(false);
    }
  });

  it("honors SHOWCASE_BACKEND_HOST_PATTERN and DOCS_HOST at request time", () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://staging.example.com";
    process.env.SHOWCASE_BACKEND_HOST_PATTERN =
      "showcase-{slug}-staging.up.railway.app";
    process.env.DOCS_HOST = "https://docs-staging.example.com/";
    const cfg = getRuntimeConfig();
    expect(cfg.backendHostPattern).toBe(
      "showcase-{slug}-staging.up.railway.app",
    );
    // docsHost is a URL — trailing slash stripped like the others.
    expect(cfg.docsHost).toBe("https://docs-staging.example.com");

    // Live re-read on each call (no module-load freeze).
    process.env.DOCS_HOST = "https://docs-staging2.example.com";
    expect(getRuntimeConfig().docsHost).toBe(
      "https://docs-staging2.example.com",
    );
  });

  it("normalizes a scheme-bearing / slash-trailing SHOWCASE_BACKEND_HOST_PATTERN", () => {
    // The consumer (backendUrlFromPattern) prepends `https://` and
    // concatenates routes — a scheme-bearing value would yield
    // `https://https://…` and a trailing slash would yield `//route`.
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://showcase.copilotkit.ai";
    process.env.SHOWCASE_BACKEND_HOST_PATTERN =
      "https://showcase-{slug}-staging.up.railway.app/";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(getRuntimeConfig().backendHostPattern).toBe(
        "showcase-{slug}-staging.up.railway.app",
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("degenerate SHOWCASE_BACKEND_HOST_PATTERN falls back to the default pattern, never an empty string", async () => {
    // Fix-round interaction bug: "https://" normalized to "" with NO
    // fallback — server-side iframe srcs became literally "https://",
    // and the injected "" failed the client reader's
    // REQUIRED_CONFIG_FIELDS check, crashing EVERY client component
    // with a message blaming the layout injection instead of the env
    // var. The degenerate value must produce the default + one FATAL.
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://showcase.copilotkit.ai";
    for (const bad of ["https://", "/"]) {
      process.env.SHOWCASE_BACKEND_HOST_PATTERN = bad;
      vi.resetModules();
      const { getRuntimeConfig: freshGet } = await import("./runtime-config");
      const errs: string[] = [];
      const errSpy = vi
        .spyOn(console, "error")
        .mockImplementation((m: string) => void errs.push(m));
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const cfg = freshGet();
        expect(cfg.backendHostPattern, `pattern ${JSON.stringify(bad)}`).toBe(
          "showcase-{slug}-production.up.railway.app",
        );
        // The client reader requires a non-empty string — this is the
        // exact invariant the round-3 check enforces.
        expect(cfg.backendHostPattern.length).toBeGreaterThan(0);
        expect(
          errs.some(
            (m) =>
              m.includes("FATAL-CONFIG") &&
              m.includes("SHOWCASE_BACKEND_HOST_PATTERN"),
          ),
        ).toBe(true);
      } finally {
        errSpy.mockRestore();
        warnSpy.mockRestore();
      }
    }
  });

  it("prepends https:// when DOCS_HOST lacks a scheme (host-only misconfig)", () => {
    // Middleware does `new URL(docsHost)` on every docs route. A
    // host-only DOCS_HOST (the documented format of the sibling
    // SHOWCASE_BACKEND_HOST_PATTERN var, an easy misconfig) must NOT
    // produce an unparseable URL that 500s every docs request.
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://showcase.copilotkit.ai";
    process.env.DOCS_HOST = "docs-staging.example.com";
    const cfg = getRuntimeConfig();
    expect(cfg.docsHost).toBe("https://docs-staging.example.com");
    expect(() => new URL(cfg.docsHost)).not.toThrow();
  });

  it("prepends http:// (not https://) to scheme-less LOOPBACK hosts", () => {
    // The documented local-dev DOCS_HOST wiring is `localhost:3005` —
    // an https:// prepend turns it into a TLS-failing destination with
    // zero warn (nothing serves TLS on a local dev port). Loopback
    // hosts (localhost, 127.0.0.1, [::1]) get http:// instead, across
    // every ensureScheme consumer (BASE_URL, DOCS_HOST, POSTHOG_HOST).
    (process.env as Record<string, string>).NODE_ENV = "development";
    process.env.BASE_URL = "localhost:3000";
    process.env.DOCS_HOST = "localhost:3005";
    process.env.POSTHOG_HOST = "127.0.0.1:8010";
    const cfg = getRuntimeConfig();
    expect(cfg.baseUrl).toBe("http://localhost:3000");
    expect(cfg.docsHost).toBe("http://localhost:3005");
    expect(cfg.posthogHost).toBe("http://127.0.0.1:8010");

    // IPv6 loopback too.
    process.env.DOCS_HOST = "[::1]:3005";
    expect(getRuntimeConfig().docsHost).toBe("http://[::1]:3005");
  });

  it("preserves an explicit http:// scheme on DOCS_HOST", () => {
    (process.env as Record<string, string>).NODE_ENV = "development";
    process.env.BASE_URL = "http://localhost:3000";
    process.env.DOCS_HOST = "http://localhost:3005";
    expect(getRuntimeConfig().docsHost).toBe("http://localhost:3005");
  });

  it("falls back to the default docs host (with one loud log) when DOCS_HOST is unparseable", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://showcase.copilotkit.ai";
    // Spaces make the host unparseable even after prepending https://.
    process.env.DOCS_HOST = "not a parseable host";
    // Warn-once module state — fresh module instance so the assertion
    // is order-independent and retry-safe.
    vi.resetModules();
    const { getRuntimeConfig: freshGet } = await import("./runtime-config");
    const errs: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m: string) => {
      errs.push(m);
    });
    try {
      const cfg = freshGet();
      expect(cfg.docsHost).toBe("https://docs.showcase.copilotkit.ai");
      expect(() => new URL(cfg.docsHost)).not.toThrow();
      expect(errs.some((m) => m.includes("DOCS_HOST"))).toBe(true);
      // Loud log fires ONCE per bad value, not per request.
      const before = errs.length;
      freshGet();
      expect(errs.length).toBe(before);
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects a degenerate DOCS_HOST of just a scheme (https://) with the loud fallback", async () => {
    // `https://` strips to `https:`, the prepend yields
    // `https://https:`, and that PARSES (hostname "https") — it used to
    // slip through silently and break every docs redirect.
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://showcase.copilotkit.ai";
    process.env.DOCS_HOST = "https://";
    vi.resetModules();
    const { getRuntimeConfig: freshGet } = await import("./runtime-config");
    const errs: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m: string) => {
      errs.push(m);
    });
    try {
      const cfg = freshGet();
      expect(cfg.docsHost).toBe("https://docs.showcase.copilotkit.ai");
      expect(errs.some((m) => m.includes("DOCS_HOST"))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("prepends https:// when BASE_URL lacks a scheme (host-only misconfig)", async () => {
    // Consumers compose `new URL(path, baseUrl)` — a scheme-less value
    // previously passed readUrl unvalidated and threw at every compose
    // site: opaque 500s with NO log (the env var IS set, so the
    // unset-fallback never fires).
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "shell.copilotkit.ai";
    // The no-FATAL assertion below is an ABSENCE assertion — vacuous on
    // the static module instance if a prior test consumed the BASE_URL
    // once-guard. Fresh module so a log would actually fire.
    vi.resetModules();
    const { getRuntimeConfig: freshGet } = await import("./runtime-config");
    const errs: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m: string) => {
      errs.push(m);
    });
    try {
      const cfg = freshGet();
      expect(cfg.baseUrl).toBe("https://shell.copilotkit.ai");
      expect(() => new URL("/some/path", cfg.baseUrl)).not.toThrow();
      // The prepend FIXES the value — no FATAL noise for it.
      expect(errs.some((m) => m.includes("BASE_URL"))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("falls back to the sentinel (one loud log naming the value) for a degenerate BASE_URL of just a scheme", async () => {
    // `https://` is reduced to `https:` by the trailing-slash strip,
    // ensureScheme yields `https://https:` which PARSES (hostname
    // "https") — it must be rejected, not silently returned.
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://";
    vi.resetModules();
    const { getRuntimeConfig: freshGet } = await import("./runtime-config");
    const errs: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m: string) => {
      errs.push(m);
    });
    try {
      const cfg = freshGet();
      expect(cfg.baseUrl).toBe("https://shell-base-url-missing.invalid");
      expect(() => new URL("/some/path", cfg.baseUrl)).not.toThrow();
      // The log must NAME the bad value so the operator can find it.
      // (readUrl's trailing-slash strip runs first, so the named value
      // is the post-strip "https:" — still unambiguous.)
      expect(
        errs.some((m) => m.includes("BASE_URL") && m.includes('"https:')),
      ).toBe(true);
      // Once-guarded — not per request.
      const before = errs.length;
      freshGet();
      expect(errs.length).toBe(before);
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects a non-http(s) BASE_URL scheme with the sentinel (ftp:// and the dot-scheme edge)", async () => {
    // `ftp://shell.x` parses fine; `example.com://oops` matches
    // SCHEME_RE (dot is a valid scheme char) so ensureScheme leaves it
    // and it parses with protocol "example.com:" and hostname "oops".
    // Neither can serve consumers composing http(s) URLs.
    (process.env as Record<string, string>).NODE_ENV = "production";
    for (const bad of ["ftp://shell.example.com", "example.com://oops"]) {
      process.env.BASE_URL = bad;
      vi.resetModules();
      const { getRuntimeConfig: freshGet } = await import("./runtime-config");
      const errs: string[] = [];
      const spy = vi
        .spyOn(console, "error")
        .mockImplementation((m: string) => void errs.push(m));
      try {
        const cfg = freshGet();
        expect(cfg.baseUrl, `value ${JSON.stringify(bad)}`).toBe(
          "https://shell-base-url-missing.invalid",
        );
        expect(
          errs.some((m) => m.includes("BASE_URL") && m.includes("scheme")),
          `value ${JSON.stringify(bad)} should log a scheme rejection`,
        ).toBe(true);
      } finally {
        spy.mockRestore();
      }
    }
  });

  it("rejects a mailto: BASE_URL (userinfo after the https:// prepend) with the sentinel", async () => {
    // `mailto:ops@example.com` lacks `://` so SCHEME_RE misses it and
    // the prepend yields `https://mailto:ops@example.com` — a URL with
    // userinfo "mailto:ops" and host "example.com" that previously
    // sailed through validation.
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "mailto:ops@example.com";
    vi.resetModules();
    const { getRuntimeConfig: freshGet } = await import("./runtime-config");
    const errs: string[] = [];
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation((m: string) => void errs.push(m));
    try {
      expect(freshGet().baseUrl).toBe("https://shell-base-url-missing.invalid");
      expect(errs.some((m) => m.includes("BASE_URL"))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("origin-normalizes a BASE_URL carrying a path/query/fragment with one warn (subpath deploys unsupported)", async () => {
    // Consumers compose `new URL(path, baseUrl)` — a path/query/fragment
    // silently corrupts every composed URL (a base path is dropped by
    // composition, a fragment swallows the path).
    (process.env as Record<string, string>).NODE_ENV = "production";
    for (const [bad, why] of [
      ["https://shell.example.com/sub", "path"],
      ["https://shell.example.com?a=b", "query"],
      ["https://shell.example.com#frag", "fragment"],
    ] as const) {
      process.env.BASE_URL = bad;
      vi.resetModules();
      const { getRuntimeConfig: freshGet } = await import("./runtime-config");
      const warns: string[] = [];
      const spy = vi
        .spyOn(console, "warn")
        .mockImplementation((m: string) => void warns.push(m));
      try {
        expect(freshGet().baseUrl, `${why} should normalize to origin`).toBe(
          "https://shell.example.com",
        );
        expect(warns.some((m) => m.includes("BASE_URL"))).toBe(true);
        // Once-guarded — not per request.
        const before = warns.length;
        freshGet();
        expect(warns.length).toBe(before);
      } finally {
        spy.mockRestore();
      }
    }
  });

  it("dev-mode SET-but-malformed BASE_URL falls back to localhost with a dev warn, not the prod sentinel", async () => {
    // The module's contract is frictionless dev: a malformed value in
    // development previously fell to the PROD `.invalid` sentinel with
    // Railway-flavored guidance — useless on a laptop.
    (process.env as Record<string, string>).NODE_ENV = "development";
    process.env.BASE_URL = "https://";
    vi.resetModules();
    const { getRuntimeConfig: freshGet } = await import("./runtime-config");
    const warns: string[] = [];
    const errs: string[] = [];
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation((m: string) => void warns.push(m));
    const errSpy = vi
      .spyOn(console, "error")
      .mockImplementation((m: string) => void errs.push(m));
    try {
      const cfg = freshGet();
      expect(cfg.baseUrl).toBe("http://localhost:3000");
      expect(warns.some((m) => m.includes("BASE_URL"))).toBe(true);
      // No FATAL noise and no Railway guidance in dev.
      expect(errs.some((m) => m.includes("BASE_URL"))).toBe(false);
    } finally {
      warnSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it("unset-BASE_URL FATAL names the post-strip sentinel (consistent with the returned value)", async () => {
    // readUrl returns the trailing-slash-stripped fallback but printed
    // the PRE-strip form — the log named a value that never appears.
    (process.env as Record<string, string>).NODE_ENV = "production";
    vi.resetModules();
    const { getRuntimeConfig: freshGet } = await import("./runtime-config");
    const errs: string[] = [];
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation((m: string) => void errs.push(m));
    try {
      freshGet();
      const fatal = errs.find((m) => m.includes("BASE_URL is unset"));
      expect(fatal).toBeDefined();
      expect(fatal).toContain("https://shell-base-url-missing.invalid");
      expect(fatal).not.toContain("shell-base-url-missing.invalid/");
    } finally {
      spy.mockRestore();
    }
  });

  it("falls back to the sentinel (one loud log) when BASE_URL is unparseable garbage", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "not a base url";
    vi.resetModules();
    const { getRuntimeConfig: freshGet } = await import("./runtime-config");
    const errs: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m: string) => {
      errs.push(m);
    });
    try {
      const cfg = freshGet();
      expect(cfg.baseUrl).toBe("https://shell-base-url-missing.invalid");
      expect(
        errs.some(
          (m) => m.includes("BASE_URL") && m.includes('"not a base url"'),
        ),
      ).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("normalizes a DOCS_HOST carrying a path/query/fragment to its origin (one warn)", async () => {
    // docs-redirects composes destination paths against this value — a
    // fragment swallows the path (`https://docs.x.ai#frag` + `/docs/y`
    // lands on the docs ROOT), a query/path corrupts every destination.
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://showcase.copilotkit.ai";
    for (const [bad, why] of [
      ["https://docs.example.com/sub", "path"],
      ["https://docs.example.com?a=b", "query"],
      ["https://docs.example.com#frag", "fragment"],
    ] as const) {
      process.env.DOCS_HOST = bad;
      vi.resetModules();
      const { getRuntimeConfig: freshGet } = await import("./runtime-config");
      const warns: string[] = [];
      const spy = vi.spyOn(console, "warn").mockImplementation((m: string) => {
        warns.push(m);
      });
      try {
        const cfg = freshGet();
        expect(cfg.docsHost, `${why} should normalize to origin`).toBe(
          "https://docs.example.com",
        );
        expect(warns.some((m) => m.includes("DOCS_HOST"))).toBe(true);
        // Once-guarded — not per request.
        const before = warns.length;
        freshGet();
        expect(warns.length).toBe(before);
      } finally {
        spy.mockRestore();
      }
    }
  });

  it("rejects a non-http(s) DOCS_HOST scheme (ftp://) with the loud fallback", async () => {
    // `ftp://docs.example.com` parses fine — but no middleware redirect
    // destination can ever use it; it must not pass validation silently.
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://showcase.copilotkit.ai";
    process.env.DOCS_HOST = "ftp://docs.example.com";
    vi.resetModules();
    const { getRuntimeConfig: freshGet } = await import("./runtime-config");
    const errs: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m: string) => {
      errs.push(m);
    });
    try {
      const cfg = freshGet();
      expect(cfg.docsHost).toBe("https://docs.showcase.copilotkit.ai");
      // The reason must be the scheme — NOT the catch-all "not a
      // parseable URL" mislabel (it parsed just fine).
      expect(
        errs.some(
          (m) =>
            m.includes("DOCS_HOST") &&
            m.includes("scheme") &&
            !m.includes("not a parseable URL"),
        ),
      ).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects a credentialed DOCS_HOST (userinfo) with the loud fallback", async () => {
    // A credentialed DOCS_HOST lands userinfo in every 308 Location —
    // browsers strip or silently block credentialed redirect
    // destinations, so docs redirects break with zero signal. Same
    // rejection validateBaseUrl has.
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://showcase.copilotkit.ai";
    for (const bad of [
      "https://user:pass@docs.example.com",
      // Scheme-less form: the https:// prepend manufactures the
      // userinfo (`user:pass@docs…` → `https://user:pass@docs…`).
      "user:pass@docs.example.com",
    ]) {
      process.env.DOCS_HOST = bad;
      vi.resetModules();
      const { getRuntimeConfig: freshGet } = await import("./runtime-config");
      const errs: string[] = [];
      const spy = vi
        .spyOn(console, "error")
        .mockImplementation((m: string) => void errs.push(m));
      try {
        const cfg = freshGet();
        expect(cfg.docsHost, `value ${JSON.stringify(bad)}`).toBe(
          "https://docs.showcase.copilotkit.ai",
        );
        expect(
          errs.some((m) => m.includes("DOCS_HOST") && m.includes("userinfo")),
          `value ${JSON.stringify(bad)} should log a userinfo rejection`,
        ).toBe(true);
      } finally {
        spy.mockRestore();
      }
    }
  });

  it("labels the degenerate-host rejection as such, not as a parse failure", async () => {
    // `https://` DID parse (hostname "https") — the operator-facing log
    // must not send them hunting for a syntax error that isn't there.
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://showcase.copilotkit.ai";
    process.env.DOCS_HOST = "https://";
    vi.resetModules();
    const { getRuntimeConfig: freshGet } = await import("./runtime-config");
    const errs: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m: string) => {
      errs.push(m);
    });
    try {
      freshGet();
      expect(
        errs.some(
          (m) => m.includes("DOCS_HOST") && !m.includes("not a parseable URL"),
        ),
      ).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("dev-mode SET-but-broken DOCS_HOST falls back with a dev warn, not FATAL-CONFIG / Railway guidance", async () => {
    // Same dev-vs-prod branch validateBaseUrl has: the FATAL-CONFIG
    // error and Railway guidance are useless on a laptop — the dev
    // contract is frictionless iteration with a warn.
    (process.env as Record<string, string>).NODE_ENV = "development";
    process.env.BASE_URL = "http://localhost:3000";
    process.env.DOCS_HOST = "https://";
    vi.resetModules();
    const { getRuntimeConfig: freshGet } = await import("./runtime-config");
    const warns: string[] = [];
    const errs: string[] = [];
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation((m: string) => void warns.push(m));
    const errSpy = vi
      .spyOn(console, "error")
      .mockImplementation((m: string) => void errs.push(m));
    try {
      const cfg = freshGet();
      // Same fallback VALUE as prod — only the log level/text branches.
      expect(cfg.docsHost).toBe("https://docs.showcase.copilotkit.ai");
      expect(warns.some((m) => m.includes("DOCS_HOST"))).toBe(true);
      // No FATAL noise and no Railway guidance in dev.
      expect(errs.some((m) => m.includes("DOCS_HOST"))).toBe(false);
      expect(
        warns.some((m) => m.includes("DOCS_HOST") && m.includes("Railway")),
      ).toBe(false);
    } finally {
      warnSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it("falls back to the default docs host (one loud log) when DOCS_HOST points at the shell's own host", async () => {
    // The redirect table has self-referential entries (/faq → /faq etc.)
    // that terminate ONLY because the destination host differs. An
    // operator pointing DOCS_HOST at the shell's own host turns ~15
    // paths into ERR_TOO_MANY_REDIRECTS loops.
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://shell.example.com";
    process.env.DOCS_HOST = "https://shell.example.com";
    vi.resetModules();
    const { getRuntimeConfig: freshGet } = await import("./runtime-config");
    const errs: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m: string) => {
      errs.push(m);
    });
    try {
      const cfg = freshGet();
      expect(cfg.docsHost).toBe("https://docs.showcase.copilotkit.ai");
      expect(errs.some((m) => m.includes("DOCS_HOST"))).toBe(true);
      // Once-guarded — not per request.
      const before = errs.length;
      freshGet();
      expect(errs.length).toBe(before);
    } finally {
      spy.mockRestore();
    }
  });

  it("disables docs redirects (sentinel) when the shell is deployed AT the default docs host with DOCS_HOST unset", async () => {
    // The unconditional DEFAULT_DOCS_HOST fallback can carry the same
    // defect it's escaping: shell deployed at the docs host with
    // DOCS_HOST unset used to log a self-contradictory FATAL ("falling
    // back to <the same looping value>") AND return the looping value.
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://docs.showcase.copilotkit.ai";
    // DOCS_HOST deliberately unset.
    vi.resetModules();
    const { getRuntimeConfig: freshGet, DOCS_REDIRECTS_DISABLED_HOST } =
      await import("./runtime-config");
    const errs: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m: string) => {
      errs.push(m);
    });
    try {
      const cfg = freshGet();
      expect(cfg.docsHost).toBe(DOCS_REDIRECTS_DISABLED_HOST);
      // The sentinel must be parseable (incidental new URL consumers)
      // and distinct from the looping default.
      expect(() => new URL(cfg.docsHost)).not.toThrow();
      expect(cfg.docsHost).not.toBe("https://docs.showcase.copilotkit.ai");
      // Branched message: names the UNSET case and says redirects are
      // disabled — never the self-contradictory "falling back to" the
      // very value that loops.
      const fatal = errs.find((m) => m.includes("DOCS_HOST"));
      expect(fatal).toBeDefined();
      expect(fatal).toContain("unset");
      expect(fatal).toContain("disabled");
      expect(fatal).not.toContain(
        "falling back to https://docs.showcase.copilotkit.ai",
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("disables docs redirects (sentinel) when DOCS_HOST is rejected AND the default fallback also collides", async () => {
    // Shell deployed at the docs host with DOCS_HOST explicitly SET to
    // that same host: the configured value is rejected (self-host) and
    // the default fallback has the identical defect — return the
    // disabled sentinel, not the looping default.
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://docs.showcase.copilotkit.ai";
    process.env.DOCS_HOST = "https://docs.showcase.copilotkit.ai";
    vi.resetModules();
    const { getRuntimeConfig: freshGet, DOCS_REDIRECTS_DISABLED_HOST } =
      await import("./runtime-config");
    const errs: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m: string) => {
      errs.push(m);
    });
    try {
      const cfg = freshGet();
      expect(cfg.docsHost).toBe(DOCS_REDIRECTS_DISABLED_HOST);
      const fatal = errs.find((m) => m.includes("DOCS_HOST"));
      expect(fatal).toBeDefined();
      expect(fatal).toContain("disabled");
      expect(fatal).not.toContain(
        "falling back to https://docs.showcase.copilotkit.ai",
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("still falls back to the default docs host when only the CONFIGURED value collides", async () => {
    // The fallback re-check must not over-trigger: a shell at its own
    // (non-docs) host with a colliding DOCS_HOST keeps the working
    // default — redirects stay enabled.
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://shell.example.com";
    process.env.DOCS_HOST = "https://shell.example.com";
    vi.resetModules();
    const { getRuntimeConfig: freshGet } = await import("./runtime-config");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(freshGet().docsHost).toBe("https://docs.showcase.copilotkit.ai");
    } finally {
      spy.mockRestore();
    }
  });

  it("does NOT trip the loop guard for same-hostname different-port docs (local dev)", () => {
    // The loop predicate is the full authority (host:port), not the
    // hostname: localhost:3000 (shell) → localhost:3005 (docs) is the
    // documented dev wiring and terminates fine.
    (process.env as Record<string, string>).NODE_ENV = "development";
    process.env.BASE_URL = "http://localhost:3000";
    process.env.DOCS_HOST = "http://localhost:3005";
    expect(getRuntimeConfig().docsHost).toBe("http://localhost:3005");
  });

  it("returns the parsed-normalized form (host case, default port) for BASE_URL/DOCS_HOST/POSTHOG_HOST", () => {
    // Validation already PARSES every value — returning the raw
    // candidate string instead of the parsed form leaked un-normalized
    // values (uppercase hosts, explicit default ports) to consumers,
    // while the internal comparisons (e.g. the docs self-host guard)
    // operate on parsed forms: the same authority could compare unequal
    // to itself depending on which side was spelled canonically.
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://Shell.Example.COM:443";
    process.env.DOCS_HOST = "https://Docs.Example.COM:443";
    process.env.POSTHOG_HOST = "https://Proxy.Example.COM:443/ingest";
    const cfg = getRuntimeConfig();
    expect(cfg.baseUrl).toBe("https://shell.example.com");
    expect(cfg.docsHost).toBe("https://docs.example.com");
    // Path preserved (reverse-proxy ingest), host normalized.
    expect(cfg.posthogHost).toBe("https://proxy.example.com/ingest");
  });

  it("strips trailing slashes", () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://showcase.example.com/";
    process.env.POSTHOG_HOST = "https://eu.i.posthog.com//";
    const cfg = getRuntimeConfig();
    expect(cfg.baseUrl).toBe("https://showcase.example.com");
    expect(cfg.posthogHost).toBe("https://eu.i.posthog.com");
  });

  it("falls back to dev defaults when unset in non-production", () => {
    (process.env as Record<string, string>).NODE_ENV = "development";
    // Spy to keep the dev-fallback warning out of the test output.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cfg = getRuntimeConfig();
      expect(cfg.baseUrl).toBe("http://localhost:3000");
      expect(cfg.posthogHost).toBe("https://eu.i.posthog.com");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("falls back to sentinel and console.errors in production (BASE_URL only)", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    // The FATAL-CONFIG log is once-guarded module state — fresh module
    // instance so the assertion survives test reordering / --retry.
    vi.resetModules();
    const { getRuntimeConfig: freshGet } = await import("./runtime-config");
    const errs: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m: string) => {
      errs.push(m);
    });
    // try/finally so a throwing call can't leak the spy into other
    // tests (matches every other spy in this file).
    let cfg: ReturnType<typeof freshGet>;
    try {
      cfg = freshGet();
    } finally {
      spy.mockRestore();
    }
    expect(cfg.baseUrl).toBe("https://shell-base-url-missing.invalid");
    // The sentinel must be a hierarchical URL: the previous
    // `about:blank#...` form was opaque-path, and `new URL(path, base)`
    // throws on opaque bases — the sentinel itself 500'd composing
    // consumers.
    expect(() => new URL("/some/path", cfg.baseUrl)).not.toThrow();
    // POSTHOG_HOST falls back silently (analytics key — legitimately absent in some envs).
    expect(cfg.posthogHost).toBe("https://eu.i.posthog.com");
    expect(errs.some((m) => m.includes("BASE_URL"))).toBe(true);
    expect(errs.some((m) => m.includes("POSTHOG_HOST"))).toBe(false);
  });

  it("FATAL-CONFIG for unset BASE_URL logs once per process, not per request", async () => {
    // Middleware + the root layout call getRuntimeConfig() per request;
    // without the once-guard an unset prod BASE_URL spams console.error
    // on EVERY request. Fresh module instance so the guard state is
    // deterministic regardless of test order / retries.
    (process.env as Record<string, string>).NODE_ENV = "production";
    vi.resetModules();
    const { getRuntimeConfig: freshGet } = await import("./runtime-config");
    const errs: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m: string) => {
      errs.push(m);
    });
    try {
      freshGet();
      expect(errs.filter((m) => m.includes("BASE_URL")).length).toBe(1);
      freshGet();
      freshGet();
      expect(errs.filter((m) => m.includes("BASE_URL")).length).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("dev fallback warning for unset BASE_URL logs once per process, not per call", async () => {
    (process.env as Record<string, string>).NODE_ENV = "development";
    vi.resetModules();
    const { getRuntimeConfig: freshGet } = await import("./runtime-config");
    const warns: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((m: string) => {
      warns.push(m);
    });
    try {
      freshGet();
      expect(warns.filter((m) => m.includes("BASE_URL")).length).toBe(1);
      freshGet();
      expect(warns.filter((m) => m.includes("BASE_URL")).length).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("reads live process.env on each call (no module-load freeze)", () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://first.example.com";
    process.env.POSTHOG_HOST = "https://eu.i.posthog.com";
    expect(getRuntimeConfig().baseUrl).toBe("https://first.example.com");
    process.env.BASE_URL = "https://second.example.com";
    expect(getRuntimeConfig().baseUrl).toBe("https://second.example.com");
  });

  it("accepts NEXT_PUBLIC_BASE_URL as a fallback when BASE_URL is unset", () => {
    // Deploy-config contract: the shell reads the bare name first,
    // but tolerates the NEXT_PUBLIC_-prefixed variant so a Railway
    // service that follows the shell-docs convention still wires
    // through. See the readUrl fallback chain in runtime-config.ts.
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.NEXT_PUBLIC_BASE_URL = "https://alt.example.com";
    // BASE_URL deliberately unset.
    const cfg = getRuntimeConfig();
    expect(cfg.baseUrl).toBe("https://alt.example.com");
  });

  it("BASE_URL takes precedence over NEXT_PUBLIC_BASE_URL when both set", () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://primary.example.com";
    process.env.NEXT_PUBLIC_BASE_URL = "https://alt.example.com";
    const cfg = getRuntimeConfig();
    expect(cfg.baseUrl).toBe("https://primary.example.com");
  });

  it("trims whitespace paste artifacts from env values", () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "  https://showcase.copilotkit.ai \n";
    process.env.POSTHOG_HOST = " https://eu.i.posthog.com ";
    process.env.DOCS_HOST = "\thttps://docs-staging.example.com ";
    const cfg = getRuntimeConfig();
    expect(cfg.baseUrl).toBe("https://showcase.copilotkit.ai");
    expect(cfg.posthogHost).toBe("https://eu.i.posthog.com");
    expect(cfg.docsHost).toBe("https://docs-staging.example.com");
  });

  it("whitespace-only primary counts as unset (falls through to alternate)", () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "   ";
    process.env.NEXT_PUBLIC_BASE_URL = "https://alt.example.com";
    expect(getRuntimeConfig().baseUrl).toBe("https://alt.example.com");
  });

  it("empty-string primary does not mask a set alternate (length-aware fallback)", () => {
    // A deliberately-empty BASE_URL must NOT win over a populated
    // NEXT_PUBLIC_BASE_URL. The prior `??` form treated `""` as
    // "set", masking the alternate; the length-aware form falls
    // through to the alternate when the primary is empty.
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "";
    process.env.NEXT_PUBLIC_BASE_URL = "https://alt.example.com";
    const cfg = getRuntimeConfig();
    expect(cfg.baseUrl).toBe("https://alt.example.com");
  });

  it("prepends https:// when POSTHOG_HOST lacks a scheme (host-only misconfig)", () => {
    // Middleware capture fetches build URLs from posthogHost and swallow
    // failures by design — a scheme-less value would make EVERY capture
    // throw, forever and silently. Same hardening as DOCS_HOST.
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://showcase.copilotkit.ai";
    process.env.POSTHOG_HOST = "eu.i.posthog.com";
    const cfg = getRuntimeConfig();
    expect(cfg.posthogHost).toBe("https://eu.i.posthog.com");
    expect(() => new URL(cfg.posthogHost)).not.toThrow();
  });

  it("preserves an explicit scheme on POSTHOG_HOST", () => {
    (process.env as Record<string, string>).NODE_ENV = "development";
    process.env.BASE_URL = "http://localhost:3000";
    process.env.POSTHOG_HOST = "http://localhost:8010";
    expect(getRuntimeConfig().posthogHost).toBe("http://localhost:8010");
  });

  it("accepts NEXT_PUBLIC_POSTHOG_HOST as a fallback when POSTHOG_HOST is unset", () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://alt-ph.example.com";
    process.env.BASE_URL = "https://shell.example.com";
    const cfg = getRuntimeConfig();
    expect(cfg.posthogHost).toBe("https://alt-ph.example.com");
  });

  it("rejects a degenerate POSTHOG_HOST of just a scheme with one warn + default fallback", async () => {
    // `https://` → readKey strips to `https:` → ensureScheme yields
    // `https://https:` which PARSES (hostname "https") and would point
    // every capture fetch at an unresolvable host — all analytics die
    // via DNS, silently. Same rejection readDocsHost has.
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://showcase.copilotkit.ai";
    process.env.POSTHOG_HOST = "https://";
    vi.resetModules();
    const { getRuntimeConfig: freshGet } = await import("./runtime-config");
    const warns: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((m: string) => {
      warns.push(m);
    });
    try {
      const cfg = freshGet();
      expect(cfg.posthogHost).toBe("https://eu.i.posthog.com");
      expect(warns.some((m) => m.includes("POSTHOG_HOST"))).toBe(true);
      // Once-guarded — not per request.
      const before = warns.length;
      freshGet();
      expect(warns.length).toBe(before);
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects a non-http(s) POSTHOG_HOST scheme with the default fallback", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://showcase.copilotkit.ai";
    process.env.POSTHOG_HOST = "ftp://ph.example.com";
    vi.resetModules();
    const { getRuntimeConfig: freshGet } = await import("./runtime-config");
    const warns: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((m: string) => {
      warns.push(m);
    });
    try {
      expect(freshGet().posthogHost).toBe("https://eu.i.posthog.com");
      expect(warns.some((m) => m.includes("POSTHOG_HOST"))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects a credentialed POSTHOG_HOST (userinfo) with one warn + default fallback", async () => {
    // The Fetch spec forbids credentialed request URLs — a userinfo-
    // bearing POSTHOG_HOST makes every capture fetch throw a TypeError
    // that middleware misattributes as a net-class failure. Same
    // rejection validateBaseUrl/readDocsHost have.
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://showcase.copilotkit.ai";
    for (const bad of [
      "https://user:pass@ph.example.com",
      // Scheme-less form: the https:// prepend manufactures the userinfo.
      "user:pass@ph.example.com",
    ]) {
      process.env.POSTHOG_HOST = bad;
      vi.resetModules();
      const { getRuntimeConfig: freshGet } = await import("./runtime-config");
      const warns: string[] = [];
      const spy = vi
        .spyOn(console, "warn")
        .mockImplementation((m: string) => void warns.push(m));
      try {
        const cfg = freshGet();
        expect(cfg.posthogHost, `value ${JSON.stringify(bad)}`).toBe(
          "https://eu.i.posthog.com",
        );
        expect(
          warns.some(
            (m) => m.includes("POSTHOG_HOST") && m.includes("userinfo"),
          ),
          `value ${JSON.stringify(bad)} should warn a userinfo rejection`,
        ).toBe(true);
        // Once-guarded — not per request.
        const before = warns.length;
        freshGet();
        expect(warns.length).toBe(before);
      } finally {
        spy.mockRestore();
      }
    }
  });

  it("preserves a path-bearing POSTHOG_HOST (reverse-proxy ingest paths are legitimate)", () => {
    // Unlike DOCS_HOST, a path here is NOT a misconfig: path-based
    // PostHog reverse proxies (e.g. /ingest) are a documented pattern.
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://showcase.copilotkit.ai";
    process.env.POSTHOG_HOST = "https://proxy.example.com/ingest";
    expect(getRuntimeConfig().posthogHost).toBe(
      "https://proxy.example.com/ingest",
    );
  });

  it("strips a query/fragment from POSTHOG_HOST (keeping the path) with one warn", async () => {
    // Capture URLs are composed against this value — a `?x=1` or
    // `#frag` corrupts every capture into a persistent root-POST with
    // misattributed http-class warns. The PATH is kept: path-based
    // reverse proxies (/ingest) are the documented pattern.
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://showcase.copilotkit.ai";
    for (const [bad, expected] of [
      [
        "https://proxy.example.com/ingest?x=1",
        "https://proxy.example.com/ingest",
      ],
      [
        "https://proxy.example.com/ingest#frag",
        "https://proxy.example.com/ingest",
      ],
      ["https://eu.i.posthog.com?x=1", "https://eu.i.posthog.com"],
    ] as const) {
      process.env.POSTHOG_HOST = bad;
      vi.resetModules();
      const { getRuntimeConfig: freshGet } = await import("./runtime-config");
      const warns: string[] = [];
      const spy = vi
        .spyOn(console, "warn")
        .mockImplementation((m: string) => void warns.push(m));
      try {
        expect(freshGet().posthogHost, `value ${JSON.stringify(bad)}`).toBe(
          expected,
        );
        expect(warns.some((m) => m.includes("POSTHOG_HOST"))).toBe(true);
        // Once-guarded — not per request.
        const before = warns.length;
        freshGet();
        expect(warns.length).toBe(before);
      } finally {
        spy.mockRestore();
      }
    }
  });

  it("exposes posthogKey with readEnvPair semantics (trim + NEXT_PUBLIC_ fallback)", () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://showcase.copilotkit.ai";

    // Unset → undefined (legitimately absent off-prod; no log).
    expect(getRuntimeConfig().posthogKey).toBeUndefined();

    // Whitespace paste artifacts trimmed.
    process.env.POSTHOG_KEY = " phc_primary \n";
    expect(getRuntimeConfig().posthogKey).toBe("phc_primary");

    // NEXT_PUBLIC_ fallback when the bare name is unset/empty.
    process.env.POSTHOG_KEY = "";
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_alt";
    expect(getRuntimeConfig().posthogKey).toBe("phc_alt");

    // Bare name wins when both are set.
    process.env.POSTHOG_KEY = "phc_primary";
    expect(getRuntimeConfig().posthogKey).toBe("phc_primary");
  });

  it("getRuntimeConfigForMiddleware skips noStore() (Edge runtime path)", async () => {
    // Fresh module pair (SU6-B7): earlier tests in this file call
    // vi.resetModules(), so the STATIC getRuntimeConfig import is bound
    // to a stale module instance — whether its next/cache binding is
    // the object spied on below depends on vitest mock-registry
    // caching internals. Reset and import BOTH modules from the same
    // fresh registry generation so the spy provably wraps the exact
    // unstable_noStore these calls go through.
    vi.resetModules();
    const cacheMod = await import("next/cache");
    const noStoreSpy = vi.spyOn(cacheMod, "unstable_noStore");
    // try/finally so a failing assertion can't leak the spy into other
    // tests — mockRestore after the assertions alone never runs on failure.
    try {
      (process.env as Record<string, string>).NODE_ENV = "production";
      process.env.BASE_URL = "https://edge.example.com";
      process.env.POSTHOG_HOST = "https://edge-posthog.example.com";

      const { getRuntimeConfigForMiddleware, getRuntimeConfig: freshGet } =
        await import("./runtime-config");
      const cfg = getRuntimeConfigForMiddleware();
      expect(cfg.baseUrl).toBe("https://edge.example.com");
      expect(noStoreSpy).not.toHaveBeenCalled();

      // And confirm the default entrypoint DOES call noStore() — via
      // the SAME fresh module instance, not the stale static import.
      noStoreSpy.mockClear();
      freshGet();
      expect(noStoreSpy).toHaveBeenCalledTimes(1);
    } finally {
      noStoreSpy.mockRestore();
    }
  });
});
