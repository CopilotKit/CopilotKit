/**
 * The test of the stand-ins of one package, from the table. The package tests
 * import it, as they import the core test utilities:
 *
 *   import * as entry from "../index";
 *   describeRemovedExports("@copilotkit/react-core", entry);
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  NOT_STUBBED,
  REMOVED_EXPORTS,
  RESTORED_BY_V2_ALIAS,
} from "../removed-exports-table";
import { removedApiMessage } from "../utils/errors";

/**
 * The 1.x exports, written by scripts/deprecations/removed-exports.mts. A
 * package's tests run in its directory, packages/<name>.
 */
const V1_EXPORTS_FILE = path.resolve(
  process.cwd(),
  "../../scripts/deprecations/removed-exports.v1.json",
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function namesIn(value: unknown) {
  return Array.isArray(value)
    ? value.filter((name): name is string => typeof name === "string")
    : [];
}

/** The names that `packageName` exported as functions or classes in 1.x. */
function valueNamesOf(packageName: string) {
  const v1: unknown = JSON.parse(readFileSync(V1_EXPORTS_FILE, "utf8"));
  const packages = isRecord(v1) ? v1.packages : undefined;
  const entry = isRecord(packages) ? packages[packageName] : undefined;
  const entrypoints = isRecord(entry) ? entry.entrypoints : undefined;
  const names = new Set<string>();
  const lists = isRecord(entrypoints) ? Object.values(entrypoints) : [];
  for (const list of lists) {
    if (!isRecord(list)) continue;
    for (const name of namesIn(list.functions)) names.add(name);
    for (const name of namesIn(list.classes)) names.add(name);
  }
  return names;
}

/** `@copilotkit/runtime/node` → `@copilotkit/runtime`. */
function packageOf(module: string) {
  return module.split("/").slice(0, 2).join("/");
}

/** What `run` threw. */
function thrownBy(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

/** Calls the stand-in as plain JavaScript code does. */
function call(stub: unknown) {
  if (typeof stub !== "function")
    throw new Error(`not a function: ${typeof stub}`);
  return stub();
}

/** Constructs the stand-in as plain JavaScript code does. */
function construct(stub: unknown) {
  if (typeof stub !== "function")
    throw new Error(`not a function: ${typeof stub}`);
  return Reflect.construct(stub, []);
}

/**
 * Checks each table entry of `module` against the package entry `entry`: a
 * removed value is a function there that throws the removal error with the
 * message of its entry, and a removed type has no value. A removed name
 * without a stand-in (NOT_STUBBED) is not exported at all.
 */
export function describeRemovedExports(module: string, entry: object) {
  const entries = Object.entries(REMOVED_EXPORTS[module] ?? {});
  const values = valueNamesOf(packageOf(module));
  const valueEntries = entries.filter(([name]) => values.has(name));
  const typeNames = entries
    .map(([name]) => name)
    .filter((name) => !values.has(name));
  // The names that the module's 1.x entrypoints lost without a stand-in,
  // other than the ones that the deprecated /v2 alias exports again.
  const withoutStandIn = Object.entries(NOT_STUBBED)
    .filter(([importPath]) => [module, `${module}/v2`].includes(importPath))
    .flatMap(([, reasons]) => Object.entries(reasons))
    .filter(([, reason]) => reason !== RESTORED_BY_V2_ALIAS)
    .map(([name]) => name);

  describe(`the stand-ins for what ${module} removed`, () => {
    it.each(valueEntries)(
      "%s throws the removal error when code calls or constructs it",
      (name, removed) => {
        const stub = Reflect.get(entry, name);
        const expected = {
          name: "CopilotKitRemovedApiError",
          code: "REMOVED_API",
          message: removedApiMessage({ what: `"${name}"`, ...removed }),
        };

        expect(thrownBy(() => call(stub))).toMatchObject(expected);
        expect(thrownBy(() => construct(stub))).toMatchObject(expected);
      },
    );

    it("exports nothing for a removed name without a stand-in", () => {
      const exported = withoutStandIn.filter(
        (name) => Reflect.get(entry, name) !== undefined,
      );

      expect(exported).toEqual([]);
    });

    it("exports no value for a removed type", () => {
      const withValue = typeNames.filter(
        (name) => Reflect.get(entry, name) !== undefined,
      );

      expect(withValue).toEqual([]);
    });
  });
}
