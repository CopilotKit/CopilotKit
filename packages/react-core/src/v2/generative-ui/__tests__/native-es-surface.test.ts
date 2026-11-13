import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BANNED_APIS,
  scanFile,
  scanSource,
  shippedSources,
} from "../../../../../core/src/generative-ui/__tests__/hermes-api-scan";

// The surface renderer runs on React Native through
// `@copilotkit/react-core/v2/generative-ui/native`, on every engine of the
// supported range (peer react-native >=0.70). vitest runs on Node, which has
// every ES2022+ API, so a test there cannot see one that such an engine
// lacks. This check parses every source file the native entry loads at
// runtime (its relative imports, followed) and fails on the APIs that
// `hermes-api-scan.ts` bans; that file says why each one is banned. A line
// can opt out with `// hermes-ok: <reason>`.
//
// `@copilotkit/core/generative-ui` and `@copilotkit/shared/generative-ui`
// are scanned by core's `hermes-globals.test.ts`, with the same rules.

const SRC = resolve(__dirname, "../../..");
const shipped = shippedSources([resolve(__dirname, "../native.ts")]);

/** The packages the native entry may load; each is checked elsewhere. */
const EXTERNAL = [
  "@ag-ui/core",
  "@copilotkit/core",
  "@copilotkit/core/generative-ui",
  "@copilotkit/shared",
  "@copilotkit/shared/generative-ui",
  "react",
  "zod",
];

describe("the native generative UI renderer uses no API that an engine of the supported range lacks", () => {
  it("scans every module the native entry ships", () => {
    const names = shipped.files.map((file) => relative(SRC, file));
    for (const expected of [
      "v2/generative-ui/native.ts",
      "v2/generative-ui/SurfaceView.tsx",
      "v2/generative-ui/boundaries.tsx",
      "v2/generative-ui/host.tsx",
      "v2/generative-ui/runtime-context.ts",
      "v2/generative-ui/chat.tsx",
      "v2/generative-ui/hooks.ts",
      "v2/generative-ui/use-generative-ui-root.ts",
      "v2/generative-ui/catalog.ts",
      "v2/generative-ui/refs.ts",
      "v2/generative-ui/accessibility.ts",
      "v2/lib/shallow-stable-ref.ts",
    ]) {
      expect(names).toContain(expected);
    }
    // The DOM-only modules stay out of the native entry.
    expect(
      names.filter((name) =>
        /standard\/|GenerativeUISurface\.tsx|markdown\/(?!context)/.test(name),
      ),
    ).toEqual([]);
    expect(shipped.external).toEqual(EXTERNAL);
  });

  it.each(shipped.files.map((file) => [relative(SRC, file), file]))(
    "%s",
    (name, file) => {
      expect(scanFile(file, name)).toEqual([]);
    },
  );

  describe("the scan (guards the guard)", () => {
    const names = (code: string) =>
      scanSource(code).map(({ line, api }) => `${line} ${api.name}`);

    it("catches each banned API", () => {
      const samples: Record<string, string> = {
        "Object.hasOwn": "if (Object.hasOwn(a, b)) {}",
        "Error options ({ cause })": 'new Error("x", { cause: e })',
        structuredClone: "structuredClone(value)",
        "Array.prototype.at": "list.at(i)",
        "findLast / findLastIndex": "list.findLast((x) => x)",
        "Intl.PluralRules": "new Intl.PluralRules()",
        "the DOMException global": "throw new DOMException(m)",
        "window.location or window.open": "window.open(url)",
        "location.href or location.origin": "const h = host.location?.href",
      };
      expect(Object.keys(samples).sort()).toEqual(
        BANNED_APIS.map(({ name }) => name).sort(),
      );
      for (const [name, sample] of Object.entries(samples)) {
        expect(names(sample), sample).toEqual([`1 ${name}`]);
      }
    });

    it("sees a call that prettier splits over several lines", () => {
      expect(
        names(
          [
            "throw new Error(",
            "  `a long message`,",
            "  { cause: rejected },",
            ");",
            "Object",
            "  .hasOwn(a, b);",
            "const own = Object.",
            "  hasOwn;",
          ].join("\n"),
        ),
      ).toEqual([
        "1 Error options ({ cause })",
        "5 Object.hasOwn",
        "7 Object.hasOwn",
      ]);
    });

    it("catches every argument of .at, and Error options in any form", () => {
      expect(names("xs.at(0); xs.at(n - 1); xs.at(-1);")).toHaveLength(3);
      expect(names("new TypeError(m, options)")).toEqual([
        "1 Error options ({ cause })",
      ]);
      expect(names("new GenerativeUIError(m, { code, cause })")).toEqual([
        "1 Error options ({ cause })",
      ]);
      // A custom error's own second argument is not an Error option.
      expect(names("new GenerativeUIError(m, { code })")).toEqual([]);
    });

    it("ignores strings, templates, regexes and comments", () => {
      expect(
        names(
          [
            'const s = "a//b"; Object.hasOwn(o, k);',
            'const t = "Object.hasOwn(a, b) /* x";',
            "const u = `${x} structuredClone(v)`;",
            "const r = /\\/\\/ list.at(-1)/;",
            "// window.open(url)",
            "/* new Intl.PluralRules() */",
            "type T = DOMException;",
          ].join("\n"),
        ),
      ).toEqual(["1 Object.hasOwn"]);
    });

    it("honours hermes-ok only in a comment, on the line of the use", () => {
      expect(names("Object.hasOwn(a, b); // hermes-ok: polyfilled")).toEqual(
        [],
      );
      expect(names('const m = "hermes-ok: no"; Object.hasOwn(a, b);')).toEqual([
        "1 Object.hasOwn",
      ]);
      expect(
        names(
          ["/* hermes-ok: checked */ list.at(i);", "Object.hasOwn(a, b);"].join(
            "\n",
          ),
        ),
      ).toEqual(["2 Object.hasOwn"]);
    });
  });
});
