import { describe, it, expect } from "vitest";
import {
  assembleDocument,
  buildImportMapScript,
  DEFAULT_OPEN_GEN_UI_LIBRARIES,
  mergeLibraries,
} from "../assembleDocument";

// Legacy reference implementations, copied verbatim from
// OpenGenerativeUIRenderer.tsx. Hoisted to module scope so the invariant sweep
// can reuse them without re-declaring on every test invocation.
const legacyEnsureHeadRef = (html: string) =>
  /<head[\s>]/i.test(html) ? html : `<head></head>${html}`;
const legacyInjectRef = (html: string, css: string) => {
  const i = html.indexOf("</head>");
  return i !== -1
    ? html.slice(0, i) + `<style>${css}</style>` + html.slice(i)
    : `<head><style>${css}</style></head>${html}`;
};

describe("assembleDocument", () => {
  const KIT = "body{--x:1}";

  it("injects importmap then kit at head start, in order", () => {
    const out = assembleDocument("<head><title>t</title></head><body></body>", {
      designSystemCss: KIT,
      importMap: { three: "https://esm.sh/three@0.180.0" },
    });
    const importmapIdx = out.indexOf('<script type="importmap">');
    const kitIdx = out.indexOf("data-ck-design-system");
    const titleIdx = out.indexOf("<title>");
    expect(importmapIdx).toBeGreaterThan(-1);
    expect(importmapIdx).toBeLessThan(kitIdx);
    expect(kitIdx).toBeLessThan(titleIdx);
  });

  it("creates a head when html has none", () => {
    const out = assembleDocument("<body><p>x</p></body>", {
      designSystemCss: KIT,
      importMap: false,
    });
    expect(out).toMatch(/^<head>/);
    expect(out).toContain("data-ck-design-system");
  });

  it("injects agent css before </head>, after the kit", () => {
    const out = assembleDocument("<head></head><body></body>", {
      css: ".a{color:red}",
      designSystemCss: KIT,
      importMap: false,
    });
    expect(out.indexOf("data-ck-design-system")).toBeLessThan(
      out.indexOf(".a{color:red}"),
    );
    expect(out.indexOf(".a{color:red}")).toBeLessThan(out.indexOf("</head>"));
  });

  it("emits valid importmap JSON with the pinned defaults", () => {
    const script = buildImportMapScript(DEFAULT_OPEN_GEN_UI_LIBRARIES);
    const json = JSON.parse(
      script.replace('<script type="importmap">', "").replace("</script>", ""),
    );
    expect(json.imports.three).toMatch(/^https:\/\/esm\.sh\/three@\d/);
    expect(json.imports["three/"]).toMatch(/\/$/);
  });

  it("matches the legacy path byte-for-byte when designSystemCss and importMap are false", () => {
    // legacy reference implementations, copied verbatim from OpenGenerativeUIRenderer.tsx
    const legacyEnsureHead = (html: string) =>
      /<head[\s>]/i.test(html) ? html : `<head></head>${html}`;
    const legacyInject = (html: string, css: string) => {
      const i = html.indexOf("</head>");
      return i !== -1
        ? html.slice(0, i) + `<style>${css}</style>` + html.slice(i)
        : `<head><style>${css}</style></head>${html}`;
    };
    for (const html of [
      "<head></head><body>a</body>",
      "<body>b</body>",
      "<div>c</div>",
    ]) {
      for (const css of [undefined, ".x{}"]) {
        const legacy = legacyEnsureHead(css ? legacyInject(html, css) : html);
        const next = assembleDocument(html, {
          css,
          designSystemCss: false,
          importMap: false,
        });
        expect(next).toBe(legacy);
      }
    }
  });

  // Finding 1: a <header> element preceding a real <head> must not capture the
  // kit/importmap insertion point. The prefix belongs inside the real <head>.
  it("inserts kit + importmap into the real <head>, not a preceding <header>", () => {
    const out = assembleDocument(
      "<header>Title</header><head></head><body>x</body>",
      {
        designSystemCss: KIT,
        importMap: { three: "https://esm.sh/three@0.180.0" },
      },
    );
    const headerOpen = out.indexOf("<header>");
    const headerClose = out.indexOf("</header>");
    const importmapIdx = out.indexOf('<script type="importmap">');
    const kitIdx = out.indexOf("data-ck-design-system");
    // The prefix must land after the </header> close tag (i.e. inside the
    // real <head>), never between <header> and </header>.
    expect(importmapIdx).toBeGreaterThan(headerClose);
    expect(kitIdx).toBeGreaterThan(headerClose);
    // Sanity: the <header> element itself is left untouched.
    expect(headerOpen).toBeGreaterThan(-1);
    expect(headerClose).toBeGreaterThan(headerOpen);
    // Order within the head is preserved: importmap before kit.
    expect(importmapIdx).toBeLessThan(kitIdx);
  });

  // Finding 2: an open <head> without a </head> must not produce a second head
  // nor invert the cascade. Order must be importmap -> kit -> agent css.
  it("handles an unclosed <head> without duplicating it (importmap -> kit -> css)", () => {
    const out = assembleDocument("<head><body><p>x</p></body>", {
      css: ".a{color:red}",
      designSystemCss: KIT,
      importMap: { three: "https://esm.sh/three@0.180.0" },
    });
    // Exactly one <head opening tag — no duplicate head was prepended.
    const headOpenings =
      out.match(/<head(\s(?:[^<>"']|"[^"]*"|'[^']*')*)?>/gi) ?? [];
    expect(headOpenings).toHaveLength(1);
    // Cascade order: importmap, then kit, then agent css.
    const importmapIdx = out.indexOf('<script type="importmap">');
    const kitIdx = out.indexOf("data-ck-design-system");
    const cssIdx = out.indexOf(".a{color:red}");
    expect(importmapIdx).toBeGreaterThan(-1);
    expect(importmapIdx).toBeLessThan(kitIdx);
    expect(kitIdx).toBeLessThan(cssIdx);
  });

  // Finding 2 (constraint): in PURE LEGACY mode the unclosed-<head> quirk must
  // remain byte-identical to the legacy algorithm (prepend a second head).
  it("preserves the legacy prepend-second-head quirk for unclosed <head> in pure legacy mode", () => {
    const html = "<head><body><p>x</p></body>";
    const css = ".a{color:red}";
    // Legacy reference: ensureHead is a no-op (a head-opening tag exists), then
    // injectCssIntoHtml finds no </head> and prepends a fresh head.
    const legacy = `<head><style>${css}</style></head>${html}`;
    const next = assembleDocument(html, {
      css,
      designSystemCss: false,
      importMap: false,
    });
    expect(next).toBe(legacy);
  });

  // Quote-aware head tokenization + case-insensitive close lookup: for an
  // uppercase head with no lowercase `</head>`, the agent css must land
  // immediately before the (uppercase) close tag — i.e. AFTER the head's
  // existing content — not right after the kit. A case-sensitive
  // `indexOf("</head>")` would miss `</HEAD>` and drop the css after the kit,
  // inverting the css-wins-over-head-content cascade.
  it("places agent css before the uppercase close tag (after head content)", () => {
    const out = assembleDocument(
      "<HEAD ><title>t</title></HEAD><body>u</body>",
      {
        css: ".a{color:red}",
        designSystemCss: KIT,
        importMap: { three: "https://esm.sh/three@0.180.0" },
      },
    );
    const titleIdx = out.indexOf("<title>");
    const cssIdx = out.indexOf(".a{color:red}");
    expect(titleIdx).toBeGreaterThan(-1);
    expect(cssIdx).toBeGreaterThan(-1);
    // Agent css lands after the head's content (the <title>), i.e. immediately
    // before the close tag — not right after the kit.
    expect(cssIdx).toBeGreaterThan(titleIdx);
  });

  // Literal-`<head>` normalization: an attributed head-open token
  // (`<head lang="en">`) is rewritten to the exact 6-char literal `<head>` that
  // real @jetbrains/websandbox requires to mount (`includes('<head>')` gate +
  // `replace('<head>', …)` bootstrap, websandbox.js:450/462). The `lang`
  // attribute is intentionally dropped (head attributes have negligible runtime
  // semantics and CANNOT be preserved). The full cascade still holds:
  // importmap -> kit -> agent css, with css immediately before the close.
  it("normalizes an attributed head-open token to the literal <head> and drops its attributes", () => {
    const out = assembleDocument(
      '<head lang="en"><title>t</title></head><body>x</body>',
      {
        css: ".a{color:red}",
        designSystemCss: KIT,
        importMap: { three: "https://esm.sh/three@0.180.0" },
      },
    );
    // The literal token websandbox demands is present.
    expect(out).toContain("<head>");
    // The attributes were dropped: no attributed head-OPEN token survives.
    // Scoped to this input (which contains no `<header>`), so the broad
    // `/<head[^>]+>/` cannot false-positive on a `<header …>` element.
    expect(out).not.toMatch(/<head[^>]+>/);
    // The original attribute string is gone entirely.
    expect(out).not.toContain('lang="en"');
    // Cascade order: importmap -> kit -> agent css.
    const importmapIdx = out.indexOf('<script type="importmap">');
    const kitIdx = out.indexOf("data-ck-design-system");
    const cssIdx = out.indexOf(".a{color:red}");
    const closeIdx = out.indexOf("</head>");
    expect(importmapIdx).toBeGreaterThan(-1);
    expect(importmapIdx).toBeLessThan(kitIdx);
    expect(kitIdx).toBeLessThan(cssIdx);
    // …and the agent css lands before the head close tag.
    expect(cssIdx).toBeLessThan(closeIdx);
  });

  // Close-anchor finding: the agent-css close-tag search must target the SAME
  // head the prefix (importmap + kit) was anchored to. When a stray `</head>`
  // precedes the real `<head>`, the open-tag matcher correctly skips the stray
  // and lands on the real head — but a global `</head>` search would resolve to
  // the earlier stray close, splicing the agent css BEFORE the prefix and
  // OUTSIDE the real head. That inverts the documented cascade
  // (importmap -> kit -> agent css). Scoping the close search to the region
  // at/after the prefix insertion point pins the css inside the real head.
  it("anchors agent css to the real head's close, not a stray earlier </head>", () => {
    const html = "foo</head><head><title>t</title></head><body>x</body>";
    const out = assembleDocument(html, {
      css: ".a{color:red}",
      designSystemCss: KIT,
      importMap: { three: "https://esm.sh/three@0.180.0" },
    });
    const importmapIdx = out.indexOf('<script type="importmap">');
    const kitIdx = out.indexOf("data-ck-design-system");
    const cssIdx = out.indexOf(".a{color:red}");
    // The real `<head>` open tag (the stray leading token is `</head>`, which
    // does not match the slash-free `<head>`). The prefix is spliced just after
    // this open, so the real head's content (`<title>`) and its close tag both
    // follow it.
    const realHeadOpenIdx = out.indexOf("<head>");
    const titleIdx = out.indexOf("<title>");
    // The real head's close tag: the first `</head>` at/after the real open
    // (skipping the stray `</head>` that precedes it).
    const realHeadCloseIdx = out.indexOf("</head>", realHeadOpenIdx);

    expect(importmapIdx).toBeGreaterThan(-1);
    expect(realHeadOpenIdx).toBeGreaterThan(-1);
    expect(titleIdx).toBeGreaterThan(-1);
    expect(realHeadCloseIdx).toBeGreaterThan(-1);

    // Cascade order: importmap, then kit, then agent css — all present and
    // strictly ordered (the stray close must not pull css ahead of the prefix).
    expect(importmapIdx).toBeLessThan(kitIdx);
    expect(kitIdx).toBeLessThan(cssIdx);

    // The agent css lands INSIDE the real head: after the real `<head>` open
    // and the head's own content (`<title>`), and before that head's close tag
    // — not at the stray `</head>` that precedes the real head.
    expect(cssIdx).toBeGreaterThan(realHeadOpenIdx);
    expect(cssIdx).toBeGreaterThan(titleIdx);
    expect(cssIdx).toBeLessThan(realHeadCloseIdx);
  });

  // Finding 3: an empty importMap object must not emit an inert importmap script.
  it("emits no importmap script when importMap is an empty object", () => {
    const out = assembleDocument("<head></head><body></body>", {
      designSystemCss: KIT,
      importMap: {},
    });
    expect(out).not.toContain('<script type="importmap">');
    // The kit still injects normally.
    expect(out).toContain("data-ck-design-system");
  });

  // Convergence sweep: a single input matrix that pins the two invariants this
  // function keeps drifting on — (1) byte-identity to legacy when no prefix is
  // injected, and (2) no duplicate head / correct cascade order in non-legacy
  // mode. Adding a degenerate input here is cheaper than discovering the next
  // off-by-one in production.
  describe("input-matrix invariant sweep", () => {
    // Reuse the module-scoped legacy reference implementations (verbatim from
    // OpenGenerativeUIRenderer.tsx, identical to the byte-equivalence test).
    const legacyEnsureHead = legacyEnsureHeadRef;
    const legacyInject = legacyInjectRef;

    const INPUTS = [
      "<head></head><body>a</body>",
      "<body>b</body>",
      "<div>c</div>",
      "</head><body>x</body>", // stray close before open
      "foo</head>bar",
      "<head><body>unclosed</body>", // open without close
      "<HEAD ><title>t</title></HEAD><body>u</body>", // uppercase + attr-ish
      '<head data-x="1"><title>t</title></head><body>v</body>', // attributes
      "<header>h</header><head></head><body>w</body>", // header before head
      "<header>only</header><div>z</div>", // header, no head
      "<head \nclass=x", // unterminated head token (no `>`) — must not drop prefix
      "<head\tfoo", // unterminated head token, tab + bareword — must not drop prefix
      "a<head\t<body>z</body>", // head token whose attr span runs into <body> — prefix must stay out of the body
      '<head data-x="a>b"><title>t</title></head><body>v</body>', // quoted `>` in attribute — must not splice mid-attribute
      '<head data-config=\'{"a":">"}\'>x</head><body>y</body>', // quoted `>` in single-quoted attribute — must not splice mid-attribute
      "foo</head><head><title>t</title></head><body>x</body>", // stray close before the real head — agent css must anchor to the real head's close, not the earlier stray
      "</head><head></head><body>z</body>", // leading stray close before the real head — same close-anchor hazard
    ];
    const CSS = [undefined, ".x{}"];
    // A real head-opening tag: `<head>` or `<head ...attrs>`, excluding
    // `<header ...>`. The quote-aware attribute span (matching the production
    // insertion regex) bounds the tag so it can never swallow a following
    // `<tag>`, while still tolerating a quoted `>` inside an attribute value.
    // Non-legacy mode must never emit more than one.
    const HEAD_OPEN = /<head(\s(?:[^<>"']|"[^"]*"|'[^']*')*)?>/gi;

    // (1) LEGACY MODE — byte-identical to the legacy reference for every input ×
    // css, under BOTH `importMap: false` and `importMap: {}` (an empty importmap
    // injects no prefix, so it must behave exactly like pure legacy).
    for (const importMap of [false, {} as Record<string, string>]) {
      const label = importMap === false ? "importMap:false" : "importMap:{}";
      for (const html of INPUTS) {
        for (const css of CSS) {
          it(`legacy byte-identity (${label}) — ${JSON.stringify(
            html,
          )} / css=${JSON.stringify(css)}`, () => {
            const legacy = legacyEnsureHead(
              css ? legacyInject(html, css) : html,
            );
            const next = assembleDocument(html, {
              css,
              designSystemCss: false,
              importMap,
            });
            expect(next).toBe(legacy);
          });
        }
      }
    }

    // (2) NON-LEGACY MODE — kit string + one pinned library. Assert the cascade
    // order invariants and that exactly one head-opening tag exists. Bytes are
    // not pinned here because the prefix legitimately changes the output.
    const PINNED = { three: "https://esm.sh/three@0.180.0" };
    for (const html of INPUTS) {
      for (const css of CSS) {
        it(`non-legacy order + single head — ${JSON.stringify(
          html,
        )} / css=${JSON.stringify(css)}`, () => {
          const out = assembleDocument(html, {
            css,
            designSystemCss: KIT,
            importMap: PINNED,
          });
          const importmapIdx = out.indexOf('<script type="importmap">');
          const kitIdx = out.indexOf("data-ck-design-system");
          // importmap precedes the kit.
          expect(importmapIdx).toBeGreaterThan(-1);
          expect(importmapIdx).toBeLessThan(kitIdx);
          // The structural lever: real @jetbrains/websandbox refuses to mount
          // any frameContent lacking the exact lowercase literal `<head>` —
          // `!frameContent.includes('<head>')` throws and its bootstrap injects
          // via `replace('<head>', …)` (websandbox.js:450/462). So EVERY
          // non-legacy output must contain that literal token, including the
          // uppercase/attributed inputs (`<HEAD >…`, `<head data-x="a>b">…`,
          // `<head data-config=…>`) whose open tags are normalized to `<head>`.
          expect(out).toContain("<head>");
          // Exactly one head-opening tag — non-legacy mode never duplicates the
          // head, even for the legacy-quirk inputs (stray close, unclosed head).
          expect(out.match(HEAD_OPEN) ?? []).toHaveLength(1);
          if (css) {
            const cssMarker = ".x{}";
            const cssIdx = out.indexOf(cssMarker);
            // Agent css follows the kit…
            expect(kitIdx).toBeLessThan(cssIdx);
            // …and appears exactly once.
            expect(out.split(cssMarker)).toHaveLength(2);
          }
        });
      }
    }
  });
});

describe("mergeLibraries", () => {
  // Stand-in defaults shaped like DEFAULT_OPEN_GEN_UI_LIBRARIES: every library
  // is a PAIR (bare + trailing-slash subpath form) pinned to one version.
  const DEFAULTS: Record<string, string> = {
    three: "https://esm.sh/three@0.180.0",
    "three/": "https://esm.sh/three@0.180.0/",
    gsap: "https://esm.sh/gsap@3.13.0",
    "gsap/": "https://esm.sh/gsap@3.13.0/",
    d3: "https://esm.sh/d3@7.9.0",
    "d3/": "https://esm.sh/d3@7.9.0/",
    "chart.js": "https://esm.sh/chart.js@4.5.0",
    "chart.js/": "https://esm.sh/chart.js@4.5.0/",
  };

  // (1) Overriding the bare specifier re-pins its trailing-slash sibling to the
  // SAME version (bare URL + "/"), so a generated scene never loads two copies
  // of the library. This is the core finding: a flat spread would leave
  // `three/` on the stale 0.180.0 default.
  it("re-pins the trailing-slash sibling when only the bare specifier is overridden", () => {
    const out = mergeLibraries(DEFAULTS, {
      three: "https://esm.sh/three@0.999.0",
    });
    expect(out.three).toBe("https://esm.sh/three@0.999.0");
    expect(out["three/"]).toBe("https://esm.sh/three@0.999.0/");
    // Untouched libraries keep their default pins.
    expect(out.gsap).toBe(DEFAULTS.gsap);
    expect(out["gsap/"]).toBe(DEFAULTS["gsap/"]);
  });

  // (2) An explicit user `three/` override always wins — derivation must never
  // clobber a subpath form the user set on purpose.
  it("respects an explicit trailing-slash override (not clobbered by derivation)", () => {
    const out = mergeLibraries(DEFAULTS, {
      three: "https://esm.sh/three@0.999.0",
      "three/": "https://cdn.example.com/three-subpath/",
    });
    expect(out.three).toBe("https://esm.sh/three@0.999.0");
    expect(out["three/"]).toBe("https://cdn.example.com/three-subpath/");
  });

  // (3) A brand-new library with no default sibling gets NO invented `foo/`
  // entry — we only re-pin subpath forms the defaults actually define.
  it("does not invent a trailing-slash sibling for a new library without a default sibling", () => {
    const out = mergeLibraries(DEFAULTS, {
      foo: "https://esm.sh/foo@1.0.0",
    });
    expect(out.foo).toBe("https://esm.sh/foo@1.0.0");
    expect(out).not.toHaveProperty("foo/");
  });

  // (4) An override URL that already ends in `/` must not gain a second slash.
  it("does not double the slash when the override URL already ends in one", () => {
    const out = mergeLibraries(DEFAULTS, {
      three: "https://esm.sh/three@0.999.0/",
    });
    expect(out.three).toBe("https://esm.sh/three@0.999.0/");
    expect(out["three/"]).toBe("https://esm.sh/three@0.999.0/");
  });

  // (5) Untouched defaults (gsap / d3 / chart.js) are left exactly as-is when
  // only one library is overridden.
  it("leaves untouched defaults (gsap/d3/chart.js) intact", () => {
    const out = mergeLibraries(DEFAULTS, {
      three: "https://esm.sh/three@0.999.0",
    });
    expect(out.gsap).toBe(DEFAULTS.gsap);
    expect(out["gsap/"]).toBe(DEFAULTS["gsap/"]);
    expect(out.d3).toBe(DEFAULTS.d3);
    expect(out["d3/"]).toBe(DEFAULTS["d3/"]);
    expect(out["chart.js"]).toBe(DEFAULTS["chart.js"]);
    expect(out["chart.js/"]).toBe(DEFAULTS["chart.js/"]);
  });

  // (6) esm.sh query idioms (?bundle, ?dev, ?target=es2022) are routine. The
  // subpath slash must be inserted into the PATH, before the `?`, so the
  // sibling stays a valid URL — not appended after the query.
  it("inserts the subpath slash before a query string", () => {
    const out = mergeLibraries(DEFAULTS, {
      three: "https://esm.sh/three@0.999.0?bundle",
    });
    expect(out.three).toBe("https://esm.sh/three@0.999.0?bundle");
    expect(out["three/"]).toBe("https://esm.sh/three@0.999.0/?bundle");
  });

  // (7) Same for a fragment: the slash goes before the `#`, not after it.
  it("inserts the subpath slash before a fragment", () => {
    const out = mergeLibraries(DEFAULTS, {
      three: "https://esm.sh/three@0.999.0#frag",
    });
    expect(out.three).toBe("https://esm.sh/three@0.999.0#frag");
    expect(out["three/"]).toBe("https://esm.sh/three@0.999.0/#frag");
  });

  // (8) When the path already ends with `/` (before the query), no second slash
  // is inserted — the sibling is left as-is.
  it("does not double the slash when the path already ends in one before a query", () => {
    const out = mergeLibraries(DEFAULTS, {
      three: "https://esm.sh/three@0.999.0/?bundle",
    });
    expect(out.three).toBe("https://esm.sh/three@0.999.0/?bundle");
    expect(out["three/"]).toBe("https://esm.sh/three@0.999.0/?bundle");
  });

  // (9) A clean URL with no query or fragment still gets a single trailing slash
  // (existing behavior preserved).
  it("appends a single trailing slash to a clean URL with no query or fragment", () => {
    const out = mergeLibraries(DEFAULTS, {
      three: "https://esm.sh/three@0.999.0",
    });
    expect(out["three/"]).toBe("https://esm.sh/three@0.999.0/");
  });

  // Does not mutate its inputs (the defaults map is a shared module constant).
  it("does not mutate its arguments", () => {
    const defaults = { ...DEFAULTS };
    const overrides = { three: "https://esm.sh/three@0.999.0" };
    mergeLibraries(defaults, overrides);
    expect(defaults).toEqual(DEFAULTS);
    expect(overrides).toEqual({ three: "https://esm.sh/three@0.999.0" });
  });
});
