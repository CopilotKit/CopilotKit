import type { Department } from "./types";

/**
 * The ONE place a department id becomes words.
 *
 * This map had three identical copies — the catalog renderers, the CEO
 * dashboard and the Metrics Explorer — and the publish-refusal receipt in
 * `../tools.tsx` had none, so it printed the raw ids instead: the room read
 * "Burn Rate · all · 2026-08" at the climax of the demo while the exception
 * block two inches away read "Burn Rate · Company-wide". A fourth copy would
 * have fixed that line and left the next surface to make the same mistake.
 *
 * `"all"` is a key here but is NOT a department: it is the company-wide
 * series, a real value of `MetricPoint.department` (see `./types`), and the
 * one whose raw id — the bare word "all" — reads worst of the five when it
 * escapes into a sentence.
 */
export const DEPARTMENT_LABEL: Record<Department | "all", string> = {
  manufacturing: "Manufacturing",
  distribution: "Distribution",
  "field-services": "Field services",
  corporate: "Corporate",
  all: "Company-wide",
};

/**
 * A department's display label, falling back to the RAW KEY.
 *
 * `department` is part of the query descriptor the AGENT sends, so a key
 * outside the four seeded departments is reachable — and it lands on the
 * FAILURE path by construction, since no series exists for it. The map lookup
 * yields `undefined` there, and callers lower-case it into a failure sentence:
 * the one path that exists to REPORT a bad query used to throw on one, taking
 * the whole A2UI surface down instead of showing the block that could not be
 * built. Printing the raw key also keeps the report answerable — "no data for
 * … at logistics" names what was actually asked for.
 *
 * `Object.hasOwn`, never a bare index: the key is untrusted input, so a plain
 * lookup resolves `"constructor"`, `"toString"`, `"__proto__"` … truthy off
 * the prototype chain and prints a function body where a department belongs.
 */
export const departmentLabel = (department: string): string =>
  Object.hasOwn(DEPARTMENT_LABEL, department)
    ? DEPARTMENT_LABEL[department as Department | "all"]
    : department;
