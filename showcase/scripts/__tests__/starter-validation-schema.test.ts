/**
 * The `starter_validation` schema contract, executed against the REAL schema,
 * the repo's REAL ajv stack, and all 21 REAL manifests.
 *
 * WHY THIS IS A TEST AND NOT A COMMENT. The load-bearing part of the schema is
 * the NESTING LEVEL of `additionalProperties: false` — it sits inside each
 * `oneOf` branch and NOT on the outer object — and both alternatives are wrong
 * in opposite directions:
 *
 *   - OUTER. In draft-07, `additionalProperties` is evaluated only against the
 *     sibling `properties`/`patternProperties` in the SAME schema object; it
 *     does not see through `oneOf`. The outer object has no `properties` of its
 *     own, so an outer `additionalProperties: false` declares EVERY property
 *     additional and rejects all of them — every legal block fails on every
 *     manifest, the feature is unlandable, and the cheapest repair is to delete
 *     the keyword, which lands you in the second column.
 *   - OMITTED. `oneOf` succeeds when exactly one branch validates. With no
 *     `additionalProperties`, an unlisted key is merely unconstrained, so
 *     `{supported: false, reason, path}` fails branch A and PASSES branch B —
 *     exactly one match, accepted — and `{path, srvice}` passes branch A,
 *     minting a provisioned-looking column with no service. The
 *     "a half-authored block fails validation" guarantee becomes false.
 *
 * This suite runs all three placements over all 21 manifests so the decision is
 * re-derived on every CI run rather than trusted.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "yaml";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOWCASE = path.resolve(HERE, "..", "..");
const SCHEMA = JSON.parse(
  fs.readFileSync(
    path.join(SHOWCASE, "shared", "manifest.schema.json"),
    "utf8",
  ),
) as { properties: Record<string, unknown> };

const MANIFESTS = fs
  .readdirSync(path.join(SHOWCASE, "integrations"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== "_shared")
  .map((d) => d.name)
  .sort()
  .map((slug) => {
    const doc = yaml.parse(
      fs.readFileSync(
        path.join(SHOWCASE, "integrations", slug, "manifest.yaml"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    // Strip the real block so each case injects its own.
    const { starter_validation: _drop, ...rest } = doc;
    void _drop;
    return { slug, doc, rest };
  });

function compile(schema: unknown) {
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  return ajv.compile(schema as object);
}
function withPlacement(placement: unknown) {
  const s = JSON.parse(JSON.stringify(SCHEMA));
  s.properties.starter_validation = placement;
  return s;
}
/** How many of the 21 accept `block`, under `placement`. */
function acceptCount(placement: unknown, block: unknown): number {
  const v = compile(withPlacement(placement));
  return MANIFESTS.filter((m) => v({ ...m.rest, starter_validation: block }))
    .length;
}

const BRANCH_A = {
  type: "object",
  required: ["path"],
  properties: {
    path: { type: "string" },
    service: { type: "string" },
    supported: { const: true },
  },
};
const BRANCH_B = {
  type: "object",
  required: ["supported", "reason"],
  properties: {
    supported: { const: false },
    reason: { type: "string", minLength: 1 },
  },
};
const close = (b: object) => ({ ...b, additionalProperties: false });

const PER_BRANCH = {
  type: "object",
  oneOf: [close(BRANCH_A), close(BRANCH_B)],
};
const OUTER = {
  type: "object",
  oneOf: [BRANCH_A, BRANCH_B],
  additionalProperties: false,
};
const OMITTED = { type: "object", oneOf: [BRANCH_A, BRANCH_B] };

const LEGAL: [string, unknown][] = [
  [
    "{path, service}",
    { path: "examples/integrations/x", service: "starter-x" },
  ],
  ["{path}", { path: "examples/integrations/x" }],
  ["{supported:false, reason}", { supported: false, reason: "no starter" }],
];
const ILLEGAL: [string, unknown][] = [
  [
    "{supported:false, reason, path} — a not-supported claim carrying a path",
    { supported: false, reason: "r", path: "examples/integrations/x" },
  ],
  [
    "{path, srvice} — a misspelled service key",
    { path: "examples/integrations/x", srvice: "starter-x" },
  ],
  ["{reason} — no supported discriminator", { reason: "r" }],
  ["{} — empty", {}],
  ["{supported:true} — no path", { supported: true }],
];

const N = MANIFESTS.length;

describe("starter_validation schema", () => {
  it("baseline control: the UNMODIFIED schema validates all 21 real manifests", () => {
    // Without this, a failure below could be a broken fixture rather than the
    // placement under test.
    const v = compile(SCHEMA);
    expect(N).toBe(21);
    expect(MANIFESTS.filter((m) => v(m.rest)).length).toBe(N);
  });

  it("the shipped schema validates all 21 manifests WITH their real blocks", () => {
    const v = compile(SCHEMA);
    const bad = MANIFESTS.filter((m) => !v(m.doc)).map((m) => m.slug);
    expect(bad).toEqual([]);
  });

  it("the shipped schema uses PER-BRANCH additionalProperties, not outer", () => {
    const sv = SCHEMA.properties.starter_validation as {
      additionalProperties?: unknown;
      oneOf: { additionalProperties?: unknown }[];
    };
    expect(sv.additionalProperties).toBeUndefined();
    expect(sv.oneOf).toHaveLength(2);
    for (const branch of sv.oneOf)
      expect(branch.additionalProperties).toBe(false);
  });

  describe("per-branch placement (shipped)", () => {
    for (const [label, block] of LEGAL) {
      it(`accepts ${label} on all 21`, () => {
        expect(acceptCount(PER_BRANCH, block)).toBe(N);
      });
    }
    for (const [label, block] of ILLEGAL) {
      it(`REJECTS ${label} on all 21`, () => {
        expect(acceptCount(PER_BRANCH, block)).toBe(0);
      });
    }
  });

  it("outer placement rejects every LEGAL block — the feature would be unlandable", () => {
    for (const [, block] of LEGAL) expect(acceptCount(OUTER, block)).toBe(0);
  });

  it("omitting additionalProperties ACCEPTS the two blocks that must not validate", () => {
    // The two that silently pass: a not-supported claim carrying a path, and a
    // misspelled `service`. Asserted positively so this file records WHY the
    // keyword is present rather than merely that it is.
    expect(
      acceptCount(OMITTED, {
        supported: false,
        reason: "r",
        path: "examples/integrations/x",
      }),
    ).toBe(N);
    expect(
      acceptCount(OMITTED, {
        path: "examples/integrations/x",
        srvice: "starter-x",
      }),
    ).toBe(N);
    // …while still rejecting the three that fail on `required` alone, which is
    // why "the negatives are covered" was a tempting and wrong conclusion.
    expect(acceptCount(OMITTED, { reason: "r" })).toBe(0);
    expect(acceptCount(OMITTED, {})).toBe(0);
    expect(acceptCount(OMITTED, { supported: true })).toBe(0);
  });
});
