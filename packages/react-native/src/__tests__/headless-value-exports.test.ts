import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import * as headlessEntry from "../headless";
import * as barrelEntry from "../index";
import {
  ToolCallStatus,
  UseAgentUpdate,
  CopilotKitCoreErrorCode,
  CopilotKitCoreRuntimeConnectionStatus,
  AbstractAgent,
} from "../headless";
import {
  ToolCallStatus as BarrelToolCallStatus,
  AbstractAgent as BarrelAbstractAgent,
} from "../index";
import type { RenderToolProps } from "../headless";

/**
 * Guards the EXPORT KIND of `@copilotkit/react-native`'s two public entries:
 * `src/headless.ts`, and the default barrel `src/index.ts` which republishes it
 * via `export * from "./headless"`.
 *
 * ─── The defect class this exists to make unreintroducible ───────────────────
 *
 * `export type { X }` strips X's RUNTIME binding. For a genuine type that is
 * correct. For a runtime value — an `enum`, a `class`, a function, a const — it
 * silently deletes the value half of the API:
 *
 *   - an enum's members become unnameable, and because an enum is ALSO the type
 *     of the field it annotates (and an enum-typed field rejects a bare string
 *     literal), there is then NO expression a consumer can compare that field
 *     against: `status === ToolCallStatus.Executing` fails `TS1362`, and
 *     `status === "executing"` fails `TS2322`. The field is unbranchable.
 *   - a class stops being subclassable (`extends`) and stops working with
 *     `instanceof`.
 *
 * Five symbols shipped this way from `src/headless.ts` — `ToolCallStatus`,
 * `UseAgentUpdate`, `CopilotKitCoreErrorCode`,
 * `CopilotKitCoreRuntimeConnectionStatus` and the `AbstractAgent` class — while
 * the reference docs told consumers to import and branch on them. Nothing caught
 * it: the package built, typechecked, linted and passed its suite, because
 * NOTHING IN THIS PACKAGE CONSUMED ITS OWN ENTRY the way a consumer does.
 *
 * ─── Why the guard has to live here, in react-native ─────────────────────────
 *
 * `packages/react-core/src/v2/__tests__/headless-type-exports.test-d.ts` cannot
 * cover this, structurally: it asserts against react-core's entry surface, not
 * React Native's. Proof — react-core's own `UseAgentUpdate` was ALREADY a correct
 * value export at the time RN's was wrong. Export kind is a property of the
 * re-exporting module, so only a guard reading RN's own entry can observe it.
 *
 * ─── Why a RUNTIME test rather than a `.test-d.ts` ───────────────────────────
 *
 * A stripped export is an ABSENT MODULE BINDING, which is a first-class runtime
 * observation (`mod.ToolCallStatus === undefined`). That makes a runtime test the
 * direct instrument, and a hard one to fool: no `as`, no `@ts-expect-error` and
 * no structural coincidence can make an absent binding look present, whereas a
 * type-level assertion asserts a *consequence* and can drift from it. It also
 * lets §2 below be self-extending, which a type-level test cannot be.
 *
 * This file is nonetheless BOTH. It lives under `src/`, so `tsc --noEmit`
 * (`nx run @copilotkit/react-native:check-types`) compiles it too, and §3 type-
 * checks the consumer-visible symptom. A regression therefore fails TWICE: in the
 * suite (absent binding, with a message naming the fix) and at check-types
 * (`TS1362`, naming the symbol).
 */

// ─── §1. The runtime-value contract, per symbol ──────────────────────────────

type ValueExport = {
  /** Name as a consumer imports it from the entry (post-`as`). */
  readonly name: string;
  /** `typeof` the binding: an enum is an object, a class/function is a function. */
  readonly typeOf: "object" | "function";
  /** For an enum, one member that must be nameable — that is the point of a value export. */
  readonly member?: string;
  /** Declaration site, for the failure message. */
  readonly declaredAs: string;
};

const RUNTIME_VALUE_EXPORTS: readonly ValueExport[] = [
  {
    name: "ToolCallStatus",
    typeOf: "object",
    member: "Executing",
    declaredAs: "export enum, @copilotkit/core",
  },
  {
    name: "CopilotKitCoreRuntimeConnectionStatus",
    typeOf: "object",
    member: "Connected",
    declaredAs: "export enum, @copilotkit/core",
  },
  {
    name: "CopilotKitCoreErrorCode",
    typeOf: "object",
    member: "TOOL_NOT_FOUND",
    declaredAs: "export enum, @copilotkit/core",
  },
  {
    name: "UseAgentUpdate",
    typeOf: "object",
    member: "OnMessagesChanged",
    declaredAs: "export enum, @copilotkit/react-core/v2/headless",
  },
  {
    name: "AbstractAgent",
    typeOf: "function",
    declaredAs: "declare abstract class, @ag-ui/client",
  },
];

const howToFix = (file: string) =>
  `Move it OUT of the \`export type { … }\` block in ${file}: ` +
  '`export { X } from "…"`, or drop the inline `type ` prefix. ' +
  "`export type` strips the runtime binding.";

const ENTRIES: readonly (readonly [
  label: string,
  file: string,
  mod: Record<string, unknown>,
])[] = [
  // src/headless.ts — where the export kind is declared.
  [
    "@copilotkit/react-native/headless",
    "src/headless.ts",
    headlessEntry as unknown as Record<string, unknown>,
  ],
  // src/index.ts — `export * from "./headless"` forwards the KIND as well as the
  // name, so a type-only re-export breaks this entry too. Asserted rather than
  // assumed: the barrel could grow its own (mis-kinded) re-export at any time,
  // in which case the fix belongs in src/index.ts instead.
  [
    "@copilotkit/react-native",
    'src/headless.ts (via `export * from "./headless"` in src/index.ts)',
    barrelEntry as unknown as Record<string, unknown>,
  ],
];

describe("react-native entries: runtime values are exported as VALUES", () => {
  describe.each(ENTRIES)("%s", (label, file, mod) => {
    it.each(RUNTIME_VALUE_EXPORTS.map((v) => [v.name, v] as const))(
      "%s is a runtime binding, not a type-only re-export",
      (name, spec) => {
        const why =
          `\`${name}\` is a runtime value (${spec.declaredAs}) but has NO binding on ` +
          `"${label}". ${howToFix(file)}`;

        expect(Object.keys(mod), why).toContain(name);
        expect(typeof mod[name], why).toBe(spec.typeOf);

        if (spec.member !== undefined) {
          // An enum object whose members cannot be named is still unusable.
          expect(
            Object.keys(mod[name] as object),
            `\`${name}.${spec.member}\` must be nameable by consumers of "${label}".`,
          ).toContain(spec.member);
        }
      },
    );
  });
});

// ─── §2. The self-extending half ─────────────────────────────────────────────
// §1 only knows about today's five symbols. This block needs no table: it reads
// the entry SOURCE, finds every symbol re-exported type-only, imports the module
// it came from, and fails if that module has a runtime binding for it. A future
// contributor who adds a new enum (or class, or const) re-export inside an
// `export type { … }` block is caught WITHOUT anyone updating §1.

const srcDir = path.resolve(__dirname, "..");

type ReExport = {
  /** Name as declared in the source module (pre-`as`). */
  readonly imported: string;
  /** Name a consumer imports from the entry (post-`as`). */
  readonly exported: string;
  /** Module specifier it is re-exported from. */
  readonly from: string;
  readonly typeOnly: boolean;
};

// `export [type] { … } from "…"`, across newlines. The entry files are
// hand-written re-export barrels, so this covers their whole grammar. Comments
// are stripped from the file first, so a specifier list carrying a `//` note (as
// headless.ts does around UseAgentUpdate) still parses. `export * from "./x"`
// forwards kinds unchanged and needs no check of its own — §1 asserts the barrel
// namespace directly, and "./x" is itself an ENTRY_FILES member.
const reExportRe =
  /export\s+(type\s+)?\{([\s\S]*?)\}\s*from\s*["']([^"']+)["']/g;

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function parseReExports(file: string): ReExport[] {
  const code = stripComments(fs.readFileSync(file, "utf8"));
  const out: ReExport[] = [];
  for (const m of code.matchAll(reExportRe)) {
    const blockTypeOnly = Boolean(m[1]);
    const from = m[3]!;
    for (const raw of m[2]!.split(",")) {
      const clause = raw.trim();
      if (!clause) continue;
      const inlineType = /^type\s+/.test(clause);
      const parts = clause
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .map((s) => s.trim());
      const imported = parts[0];
      if (!imported) continue;
      out.push({
        imported,
        exported: parts[1] ?? imported,
        from,
        typeOnly: blockTypeOnly || inlineType,
      });
    }
  }
  return out;
}

/**
 * Names that are a runtime value at their source but are DELIBERATELY
 * re-exported type-only from an RN entry. Keep this empty unless there is a real
 * reason: every name here is a value a consumer cannot reach.
 */
const INTENTIONALLY_TYPE_ONLY: ReadonlySet<string> = new Set<string>();

const ENTRY_FILES: readonly (readonly [label: string, file: string])[] = [
  ["src/headless.ts", path.join(srcDir, "headless.ts")],
  ["src/index.ts", path.join(srcDir, "index.ts")],
];

/** Mirrors the resolver in headless-entry-surface.test.ts. */
function resolveLocal(fromFile: string, spec: string): string {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const c of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  throw new Error(`cannot resolve local specifier "${spec}" from ${fromFile}`);
}

describe("react-native entries: no runtime value is re-exported type-only", () => {
  it.each(ENTRY_FILES)(
    "%s",
    async (label, file) => {
      const reExports = parseReExports(file);
      // A silently-rotted parser would make this test vacuously green.
      expect(
        reExports.length,
        `parsed no re-exports out of ${label}: the parser in this file has rotted, so ` +
          `this guard asserts nothing. Fix reExportRe / stripComments.`,
      ).toBeGreaterThan(10);

      const offenders: string[] = [];
      for (const re of reExports) {
        if (!re.typeOnly) continue;
        if (INTENTIONALLY_TYPE_ONLY.has(re.exported)) continue;

        const spec = re.from.startsWith(".")
          ? resolveLocal(file, re.from)
          : re.from;
        let source: Record<string, unknown>;
        try {
          source = (await import(/* @vite-ignore */ spec)) as Record<
            string,
            unknown
          >;
        } catch (err) {
          throw new Error(
            `could not import "${re.from}" (re-exported from ${label}) to check the ` +
              `export kind of \`${re.imported}\`: ` +
              (err instanceof Error ? err.message : String(err)),
            { cause: err },
          );
        }
        if (typeof source[re.imported] !== "undefined") {
          offenders.push(
            `${re.exported}${re.exported === re.imported ? "" : ` (as ${re.imported})`}` +
              ` — a runtime ${typeof source[re.imported]} in "${re.from}"`,
          );
        }
      }

      expect(
        offenders,
        `${label} re-exports runtime value(s) with \`export type\`, which strips the ` +
          `runtime binding:\n  ${offenders.join("\n  ")}\n${howToFix(label)}\n` +
          `If one is genuinely meant to stay type-only, add its exported name to ` +
          `INTENTIONALLY_TYPE_ONLY in this file, with a reason.`,
      ).toEqual([]);
    },
    30_000,
  );
});

// ─── §3. Type-level half — compiled by `tsc --noEmit`, not asserted by vitest ─
// The consumer-visible symptom, as types. If any of the five regresses to
// `export type`, this block fails check-types with TS1362 naming the symbol,
// independently of §1/§2.
//
// Everything here is INSIDE the test bodies on purpose. `tsc` checks function
// bodies just the same, but a `class X extends AbstractAgent` (or a
// `ToolCallStatus.Executing`) at MODULE scope would throw while vitest is merely
// COLLECTING the file once the binding is stripped — taking §1 and §2 down with
// it and replacing their guided messages with a bare
// "Class extends value undefined". Keeping it lazy means a regression reports as
// five precise §1 failures plus a §2 offender list, and this block on top.

describe("react-native entries: runtime values are usable as values", () => {
  it("branches a render-prop status against ToolCallStatus members", () => {
    // The reported symptom. `RenderToolProps["status"]` is the `ToolCallStatus`
    // enum type, so it rejects a bare `"executing"` literal too — without the
    // value export there is no expression that compiles here at all.
    //
    // Read through an annotated signature so `status` keeps the full enum type
    // instead of narrowing to the single member assigned, which would turn the
    // comparisons below into TS2367 ("no overlap") rather than exercising them.
    const readStatus = (): RenderToolProps<{ city: string }>["status"] =>
      ToolCallStatus.InProgress;
    const status = readStatus();
    const branch: string =
      status === ToolCallStatus.Executing
        ? "executing"
        : status === BarrelToolCallStatus.Complete
          ? "complete"
          : "other";

    expect(branch).toBe("other");
  });

  it("names the enum members consumers pass and compare by value", () => {
    // UseAgentUpdate is passed BY VALUE to useAgent's `updates` option;
    // the other two are compared BY VALUE against error/connection fields.
    const updates: UseAgentUpdate[] = [UseAgentUpdate.OnMessagesChanged];
    const codes: string[] = [
      CopilotKitCoreErrorCode.TOOL_NOT_FOUND,
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    ];

    expect(updates).toEqual(["OnMessagesChanged"]);
    expect(codes).toEqual(["tool_not_found", "connected"]);
  });

  it("subclasses AbstractAgent and matches it with instanceof", () => {
    // AbstractAgent is the AG-UI extension point: `extends` and `instanceof`
    // both need the runtime class. @ag-ui/client is a dependency (not a peer) of
    // this package, so a consumer cannot reliably reach it any other way.
    class GuardAgent extends AbstractAgent {
      run(): never {
        throw new Error("guard-only agent, never run");
      }
    }
    const isAgent = (x: unknown): boolean => x instanceof BarrelAbstractAgent;

    expect(new GuardAgent({ agentId: "guard" })).toBeInstanceOf(AbstractAgent);
    expect(isAgent(new GuardAgent({ agentId: "guard" }))).toBe(true);
    expect(isAgent({})).toBe(false);
  });
});
