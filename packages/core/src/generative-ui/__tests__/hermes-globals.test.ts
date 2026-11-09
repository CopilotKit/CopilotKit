import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Message } from "@ag-ui/client";
import { GENERATIVE_UI_FUNCTIONS } from "@copilotkit/shared";
import type {
  A2UIOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import {
  cloneValue,
  createGenerativeUI,
} from "@copilotkit/shared/generative-ui";
import { BASIC_FUNCTIONS, ExpressionError, PlatformError } from "../functions";
import { buildMarkdownSurfaces } from "../markdown-source";
import { GenerativeUISurfaceManager, surfaceKey } from "../surface-manager";
// The resolver adds calc, series and formatString to the registry.
import "../resolve";
import { scanFile, scanSource, shippedSources } from "./hermes-api-scan";
import { installHermesGlobals, looksLikeHermes } from "./hermes-globals";

// The generative UI code that React Native reaches runs on Hermes. Every
// test here runs with the globals Hermes lacks removed (see
// hermes-globals.ts), so a new use of one fails here and not on a phone.

/** Valid args for every basic function. A new function must be added. */
const SAMPLE_ARGS: Record<string, Record<string, unknown>[]> = {
  required: [{ value: "" }, { value: "x" }],
  regex: [{ value: "AB", pattern: "^[A-Z]+$" }],
  length: [{ value: "abc", min: 1, max: 5 }],
  numeric: [{ value: "7", min: 1, max: 10 }],
  email: [{ value: "a@b.co" }],
  formatNumber: [{ value: 1234.5, decimals: 1 }],
  formatCurrency: [{ value: 12.5, currency: "EUR" }],
  formatDate: [{ value: "2026-10-19T14:05:09", format: "EEE, MMM d HH:mm" }],
  pluralize: [
    { value: 0, zero: "none", one: "item", other: "items" },
    { value: 1, one: "item", other: "items" },
    { value: 5, one: "item", other: "items" },
  ],
  and: [{ values: [true, { valid: true }] }],
  or: [{ values: [false, true] }],
  not: [{ value: false }],
  openUrl: [{ url: "https://example.com/docs" }, { url: "/relative" }],
  formatString: [{ value: "Hello ${'name'}" }],
  calc: [{ expression: "seats * 29", seats: 10 }],
  series: [{ count: 2, item: "${i}" }],
};

const Noop = () => null;
const ui = createGenerativeUI({
  id: "app",
  components: {
    Column: { component: Noop, slots: { children: "multiple" } },
    Text: { component: Noop, props: z.object({ text: z.string() }) },
  },
});
const create: A2UIOperation = {
  version: "1.0",
  createSurface: { surfaceId: "s1", catalogId: "app" },
};
const data = (path: string, value: unknown): A2UIOperation => ({
  version: "1.0",
  updateDataModel: { surfaceId: "s1", path, value },
});
const components: A2UIOperation = {
  version: "1.0",
  updateComponents: {
    surfaceId: "s1",
    components: [
      { id: "root", component: "Column", children: ["note"] },
      { id: "note", component: "Text", text: { "@path": "/form/name" } },
    ],
  },
};
const content = (operations: A2UIOperation[]): GenerativeUISurfaceContent => ({
  surfaceId: "s1",
  target: "chat",
  catalogId: "app",
  operations,
  status: "streaming",
  rejected: [],
});

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

/** Only openUrl may refuse: without `open`, or for a relative URL. */
const mayRefuse = (
  name: string,
  args: Record<string, unknown>,
  variant: { open?: unknown },
) =>
  name === "openUrl" &&
  (variant.open === undefined || !String(args.url).startsWith("http"));

describe("basic functions on Hermes globals", () => {
  it("has sample args for every built-in function", () => {
    expect(Object.keys(SAMPLE_ARGS).sort()).toEqual(
      Object.keys(GENERATIVE_UI_FUNCTIONS).sort(),
    );
  });

  const cases = Object.entries(SAMPLE_ARGS).flatMap(([name, list]) =>
    list.map((args) => [name, args] as const),
  );

  it.each(cases)(
    "%s %j gives a value, or a refusal only where expected",
    (name, args) => {
      for (const url of ["0.72", "0.88"] as const) {
        for (const variant of [
          { url },
          { url, locationPolyfill: true },
          { url, locationPolyfill: true, open: vi.fn() },
        ]) {
          const label = `${name} ${JSON.stringify(variant)}`;
          restore = installHermesGlobals(variant);
          expect(looksLikeHermes()).toBe(true);
          try {
            BASIC_FUNCTIONS[name]!(args);
            expect(mayRefuse(name, args, variant), label).toBe(false);
          } catch (error) {
            // No `open` is the platform's gap; a relative URL is a bad arg.
            expect(error, label).toBeInstanceOf(
              variant.open === undefined ? PlatformError : ExpressionError,
            );
            expect(mayRefuse(name, args, variant), label).toBe(true);
          } finally {
            restore();
            restore = undefined;
          }
        }
      }
    },
  );

  it("pluralizes without Intl.PluralRules, by the English rule", () => {
    restore = installHermesGlobals();
    const args = { zero: "none", one: "item", other: "items" };
    const pluralize = (value: number, extra = args) =>
      BASIC_FUNCTIONS.pluralize!({ value, ...extra });
    expect(pluralize(0)).toBe("none");
    expect(pluralize(1)).toBe("item");
    expect(pluralize(-1)).toBe("item");
    expect(pluralize(1.5)).toBe("items");
    expect(pluralize(5)).toBe("items");
    expect(pluralize(0, { one: "item", other: "items" } as never)).toBe(
      "items",
    );
  });

  describe.each(["0.72", "0.88"] as const)(
    "openUrl with the URL class of React Native %s",
    (url) => {
      const setup = (locationHref?: string) => {
        const open = vi.fn();
        restore = installHermesGlobals({
          url,
          locationPolyfill: true,
          locationHref,
          open,
        });
        const openUrl = (target: string) => {
          try {
            BASIC_FUNCTIONS.openUrl!({ url: target });
          } catch (error) {
            expect(error).toBeInstanceOf(ExpressionError);
            throw error;
          }
        };
        return { open, openUrl };
      };

      it("refuses a relative URL against the location polyfill, which is not a page", () => {
        const { open, openUrl } = setup();
        expect(() => openUrl("/relative")).toThrow(
          '"/relative" is not an absolute URL',
        );
        expect(() => openUrl("/a#b")).toThrow('"/a#b" is not an absolute URL');
        openUrl("https://example.com/a");
        expect(open).toHaveBeenCalledTimes(1);
        expect(open).toHaveBeenCalledWith(
          "https://example.com/a",
          "_blank",
          "noopener,noreferrer",
        );
      });

      it.each([
        "http://react-native.invalid./",
        "http://localhost:8081",
        "https://app.example.com/",
      ])("treats a location of %s as no page", (locationHref) => {
        const { open, openUrl } = setup(locationHref);
        expect(() => openUrl("/relative")).toThrow(
          '"/relative" is not an absolute URL',
        );
        expect(open).not.toHaveBeenCalled();
      });

      it("takes the scheme in any case", () => {
        const { open, openUrl } = setup();
        openUrl("HTTPS://Example.com/Docs");
        openUrl("Http://example.com");
        expect(open.mock.calls.map((call) => call[0])).toEqual([
          "https://example.com/Docs",
          "http://example.com/",
        ]);
      });

      it("refuses other schemes by their lowercase name", () => {
        const { open, openUrl } = setup();
        // eslint-disable-next-line no-script-url
        expect(() => openUrl("JavaScript:alert(1)")).toThrow(
          "openUrl takes only http(s) URLs, not javascript:",
        );
        expect(() => openUrl("data:text/html,hi")).toThrow(
          "openUrl takes only http(s) URLs, not data:",
        );
        expect(open).not.toHaveBeenCalled();
      });

      it.each([
        "https://",
        "https:///path",
        "https:example.com",
        "https://exa mple.com/",
        "https://example..com/",
        "https://example.com:99999/",
        "https://exa\\mple.com/",
        "https://example.com/a\nb",
      ])("refuses %j, which has no valid host", (target) => {
        const { open, openUrl } = setup();
        expect(() => openUrl(target)).toThrow("is not a URL");
        expect(open).not.toHaveBeenCalled();
      });
    },
  );

  it("says openUrl is unavailable when window has no open", () => {
    restore = installHermesGlobals({ locationPolyfill: true });
    expect(() =>
      BASIC_FUNCTIONS.openUrl!({ url: "https://example.com/a" }),
    ).toThrow(new PlatformError("openUrl is not available on this platform"));
  });
});

describe("formatting on a Hermes build without Intl", () => {
  it("says what is missing instead of a ReferenceError or a wrong message", () => {
    restore = installHermesGlobals({ noIntl: true });
    expect(looksLikeHermes()).toBe(true);
    const call = (name: string, args: Record<string, unknown>) => () =>
      BASIC_FUNCTIONS[name]!(args);
    expect(call("formatNumber", { value: 1 })).toThrow(
      new PlatformError(
        "formatNumber needs Intl.NumberFormat, which this platform does not have",
      ),
    );
    expect(call("formatCurrency", { value: 1, currency: "EUR" })).toThrow(
      new PlatformError(
        "formatCurrency needs Intl.NumberFormat, which this platform does not have",
      ),
    );
    expect(
      call("formatDate", { value: "2026-10-19", format: "MMM d" }),
    ).toThrow(
      new PlatformError(
        "formatDate needs Intl.DateTimeFormat, which this platform does not have",
      ),
    );
    // Numeric fields need no Intl, nor does pluralize.
    expect(
      call("formatDate", {
        value: "2026-10-19T14:05",
        format: "d/M/yy HH:mm",
      })(),
    ).toBe("19/10/26 14:05");
    expect(call("pluralize", { value: 1, one: "item", other: "items" })()).toBe(
      "item",
    );
  });
});

describe("installHermesGlobals", () => {
  it("restores what it changed when a step fails partway", () => {
    const intl = Object.getOwnPropertyDescriptor(globalThis, "Intl")!;
    const clone = globalThis.structuredClone;
    const isError = (Error as { isError?: unknown }).isError;
    // Intl.PluralRules cannot be deleted, so the fourth step throws.
    Object.defineProperty(globalThis, "Intl", {
      ...intl,
      value: Object.create(null, {
        PluralRules: { value: Intl.PluralRules, configurable: false },
      }),
    });
    try {
      expect(() => installHermesGlobals()).toThrow(TypeError);
      expect(globalThis.structuredClone).toBe(clone);
      expect(typeof DOMException).toBe("function");
      expect((Error as { isError?: unknown }).isError).toBe(isError);
    } finally {
      Object.defineProperty(globalThis, "Intl", intl);
    }
  });

  it("restores every global it changed", () => {
    const before = ["URL", "navigator", "structuredClone", "window"].map(
      (name) => Object.getOwnPropertyDescriptor(globalThis, name),
    );
    installHermesGlobals({
      locationPolyfill: true,
      open: vi.fn(),
      noIntl: true,
    })();
    expect(
      ["URL", "navigator", "structuredClone", "window"].map((name) =>
        Object.getOwnPropertyDescriptor(globalThis, name),
      ),
    ).toEqual(before);
    expect(typeof Intl.PluralRules).toBe("function");
  });
});

describe("the surface manager and the markdown source on Hermes globals", () => {
  it("ingests, merges, owns, rebuilds and describes", () => {
    restore = installHermesGlobals();
    expect(looksLikeHermes()).toBe(true);
    const manager = new GenerativeUISurfaceManager(ui);
    const key = surfaceKey("t1", "s1");
    const ops = [create, components, data("/form", { email: "a@x.io" })];
    manager.ingest("t1", "default", content(ops));
    manager.setOwnedValue(key, "/form/name", { first: "Ada" });
    manager.ingest(
      "t1",
      "default",
      content([...ops, data("/", { form: { email: "b@x.io" } })]),
    );
    const surface = manager.getSurface("t1", "s1")!;
    expect(surface.model.dataModel.get("/form")).toEqual({
      email: "b@x.io",
      name: { first: "Ada" },
    });
    // A rebuild (content that does not extend the applied one).
    manager.ingest("t1", "default", content(ops.slice(0, 2)));
    expect(
      manager.getSurface("t1", "s1")!.model.dataModel.get("/form/name"),
    ).toEqual({ first: "Ada" });
    const described = manager.describeSurfaces("t1");
    expect(JSON.parse(JSON.stringify(described))).toEqual(described);
    expect(described.s1!.dataModel).toEqual({ "/form/name": { first: "Ada" } });
    const debug = manager.debugSurfaces();
    expect(debug[0]!.userValues).toEqual({ "/form/name": { first: "Ada" } });
  });

  it("refuses an uncloneable value and never crashes on a bigint", () => {
    restore = installHermesGlobals();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const manager = new GenerativeUISurfaceManager(ui);
      manager.ingest("t1", "default", content([create, components]));
      const key = surfaceKey("t1", "s1");
      // Hermes has no DOMException: the DataCloneError is an Error.
      expect(() =>
        manager.setOwnedValue(key, "/form/fn", { run: () => 1 }),
      ).toThrow(expect.objectContaining({ name: "DataCloneError" }));
      // A bigint is kept, but the agent is not told it.
      expect(() => manager.setOwnedValue(key, "/n", BigInt(1))).not.toThrow();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(manager.describeSurfaces("t1"))).toBe(
        '{"s1":{"target":"chat"}}',
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("splits a markdown surface into sub-surfaces with their own data copies", () => {
    restore = installHermesGlobals();
    const fence = [create, data("/", { plan: "team" }), components]
      .map((op) => JSON.stringify(op))
      .join("\n");
    const message: Message = {
      id: "m1",
      role: "assistant",
      content: `\`\`\`a2ui\n${fence}\n\`\`\`\n`,
    };
    const { surfaces } = buildMarkdownSurfaces([message], {
      ui,
      functions: {},
      running: false,
    });
    expect(surfaces.length).toBeGreaterThan(0);
  });

  it("clones with the DataCloneError of Hermes: an Error, not a DOMException", () => {
    restore = installHermesGlobals();
    let thrown: unknown;
    try {
      cloneValue(() => 1);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe("DataCloneError");
  });
});

// The source files of the native path: everything
// `@copilotkit/core/generative-ui` loads at runtime, with
// `@copilotkit/shared/generative-ui`, which it re-exports. They are checked
// for the APIs that an engine of the supported React Native range lacks
// (see hermes-api-scan.ts, which react-core's native-es-surface.test.ts uses
// too). A use must sit behind a feature check; such a line carries a
// `hermes-ok:` comment that says what guards it.
const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, "../../../..");
const shipped = shippedSources([resolve(here, "../index.ts")], {
  "@copilotkit/shared/generative-ui": resolve(
    SRC,
    "shared/src/generative-ui/index.ts",
  ),
});

describe("the native-path sources use no API that an engine of the supported range lacks", () => {
  it("scans the modules the native path ships", () => {
    const names = shipped.files.map((file) => relative(SRC, file));
    for (const expected of [
      "core/src/generative-ui/surface-manager.ts",
      "core/src/generative-ui/markdown-source.ts",
      "core/src/generative-ui/functions.ts",
      "shared/src/generative-ui/clone-value.ts",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it.each(shipped.files.map((file) => [relative(SRC, file), file]))(
    "%s",
    (name, file) => {
      expect(scanFile(file, name)).toEqual([]);
    },
  );

  it("finds a planted use, so the scan works", () => {
    const planted = [
      "const c = structuredClone(v);",
      "new Intl.PluralRules(locale()).select(1);",
      "throw new DOMException(m, 'DataCloneError');",
      "window.open(url);",
      "const base = host.location?.href;",
      "throw new Error(\n  'x',\n  { cause },\n);",
      "Object.hasOwn(a, b);",
      "list.at(0);",
    ];
    for (const line of planted) {
      expect(scanSource(line), line).toHaveLength(1);
    }
    expect(scanSource("// structuredClone(v)")).toEqual([]);
  });

  const QUALIFIED_CLONES = [
    "globalThis.structuredClone(v);",
    'globalThis["structuredClone"](v);',
    "globalThis['structuredClone'](v);",
    "globalThis[`structuredClone`](v);",
    "globalThis.structuredClone?.(v);",
    "window.structuredClone(v);",
    'window["structuredClone"](v);',
    "self.structuredClone(v);",
    'self["structuredClone"](v);',
    "global.structuredClone(v);",
  ];

  it.each(QUALIFIED_CLONES)("finds the qualified call %s", (line) => {
    expect(scanSource(line).map((hit) => hit.api.name)).toEqual([
      "structuredClone",
    ]);
  });

  it("leaves other receivers and non-calls of structuredClone alone", () => {
    for (const line of [
      "cloner.structuredClone(v);",
      'cloner["structuredClone"](v);',
      'globalThis["other"](v);',
      "globalThis[name](v);",
      'const s = "globalThis.structuredClone(v)";',
    ]) {
      expect(scanSource(line), line).toEqual([]);
    }
  });

  it("exempts a qualified call only on the line that has hermes-ok", () => {
    for (const line of QUALIFIED_CLONES) {
      expect(
        scanSource(`${line} // hermes-ok: feature-checked above`),
        line,
      ).toEqual([]);
      const hits = scanSource(
        [`${line} // hermes-ok: feature-checked above`, line].join("\n"),
      );
      expect(
        hits.map((hit) => [hit.line, hit.api.name]),
        line,
      ).toEqual([[2, "structuredClone"]]);
      const above = scanSource(
        ["// hermes-ok: on the wrong line", line].join("\n"),
      );
      expect(
        above.map((hit) => hit.line),
        line,
      ).toEqual([2]);
    }
  });
});
