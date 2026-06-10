import { describe, it, expect } from "vitest";
import {
  assembleDocument,
  buildImportMapScript,
  DEFAULT_OPEN_GEN_UI_LIBRARIES,
} from "../assembleDocument";

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
    const headOpenings = out.match(/<head(\s[^>]*)?>/gi) ?? [];
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
});
