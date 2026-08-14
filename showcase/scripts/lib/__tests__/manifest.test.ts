/**
 * Tests for showcase/scripts/lib/manifest.ts.
 *
 * parseManifest is the single source of truth for reading and shape-validating
 * manifest.yaml. Tests pin the tagged-union return shape that the consumers
 * (audit.ts / validate-parity.ts / capture-previews.ts) rely on.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  parseManifest,
  createDemoId,
  AGENT_KINDS,
  DEMO_FRONTENDS,
  DEFAULT_DEMO_FRONTEND,
  composePublicUrlFor,
  demoFrontendOf,
} from "../manifest.js";
import type { DemoId } from "../manifest.js";

const SCHEMA_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "shared",
  "manifest.schema.json",
);

// chmod-enforcement probe so tests that rely on EACCES can be cleanly
// skipped on CI runners that ignore chmod (running as root, certain
// network mounts). Mirrors the probe in validate-pins.test.ts.
const isRoot = process.getuid?.() === 0;
function probeChmodEnforced(): boolean {
  if (isRoot) return false;
  let probe: string | undefined;
  try {
    probe = fs.mkdtempSync(path.join(os.tmpdir(), "lib-manifest-chmod-probe-"));
    fs.chmodSync(probe, 0o000);
    try {
      fs.readdirSync(probe);
      return false;
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      return err.code === "EACCES";
    }
  } catch {
    return false;
  } finally {
    if (probe) {
      try {
        fs.chmodSync(probe, 0o755);
      } catch {
        // best-effort restore
      }
      try {
        fs.rmSync(probe, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  }
}
const chmodEnforced = probeChmodEnforced();
const cannotEnforceEacces = isRoot || !chmodEnforced;

function tmpdir(prefix = "lib-manifest-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, "utf-8");
}

/** Write `body` to a fresh manifest file under `root` and return its path.
 *  Lets one test parse several manifests without clobbering itself. */
let tmpManifestSeq = 0;
function writeTmp(root: string, body: string): string {
  const file = path.join(root, `manifest-${tmpManifestSeq++}.yaml`);
  write(file, body);
  return file;
}

describe("parseManifest", () => {
  let root: string;

  beforeEach(() => {
    root = tmpdir();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns {kind:'missing'} when the file does not exist", () => {
    const r = parseManifest(path.join(root, "does-not-exist.yaml"));
    expect(r.kind).toBe("missing");
  });

  it("returns {kind:'malformed', subkind:'shape'} for an empty file (yaml.parse → null)", () => {
    // Empty YAML parses to null, which is not a valid manifest mapping. The
    // guard must reject it before callers try to read .demos / .deployed.
    // This is a SHAPE error (YAML parsed, result was null), not a syntax
    // error.
    const f = path.join(root, "manifest.yaml");
    write(f, "");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error.length).toBeGreaterThan(0);
    }
  });

  it("returns {kind:'malformed', subkind:'shape'} for a non-object YAML (bare scalar)", () => {
    const f = path.join(root, "manifest.yaml");
    write(f, "42\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
    }
  });

  it("returns {kind:'malformed', subkind:'shape'} for an array at top level", () => {
    const f = path.join(root, "manifest.yaml");
    write(f, "- a\n- b\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
    }
  });

  it("returns {kind:'malformed', subkind:'syntax'} for a syntactically broken YAML", () => {
    // Subkind discriminator separates YAML parser failures (syntax) from
    // post-parse shape-mismatch failures (shape). CI can route these
    // differently — a syntax error is almost always a typo; a shape error
    // points at a schema-drift issue.
    const f = path.join(root, "manifest.yaml");
    write(f, "demos: [[[\nunterminated\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("syntax");
    }
  });

  it("returns {kind:'malformed', subkind:'shape'} when slug is missing", () => {
    // slug is required — every consumer (audit.ts / validate-parity.ts /
    // capture-previews.ts) relies on it. Missing slug = unconditional bug.
    const f = path.join(root, "manifest.yaml");
    write(f, "name: My Pkg\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/slug/i);
    }
  });

  it("returns {kind:'malformed', subkind:'shape'} when slug is not a string", () => {
    // YAML `slug: 42` parses to a number; the `as Manifest` cast would
    // previously have let the number propagate. parseManifest must reject.
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: 42\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/slug/i);
    }
  });

  it("returns {kind:'malformed', subkind:'shape'} when slug is the empty string", () => {
    const f = path.join(root, "manifest.yaml");
    write(f, 'slug: ""\n');
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
    }
  });

  it("returns {kind:'malformed', subkind:'shape'} when name is present but not a string", () => {
    // name is optional but, if present, must be a string. Previously the
    // `as Manifest` cast would have let a number through silently.
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: x\nname: 42\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/name/i);
    }
  });

  it("returns {kind:'malformed', subkind:'shape'} when demos is not an array", () => {
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: x\ndemos: not-array\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/demos/i);
    }
  });

  it("accepts {kind:'ok'} when demos is explicitly null (treated as omitted)", () => {
    // `demos: ~` (YAML explicit null) is semantically equivalent to
    // "demos omitted" — the current implementation short-circuits on
    // `obj.demos != null` so both null and undefined are allowed. This
    // test locks in that behavior. Prior to the simplification, the code
    // path guarded on `obj.demos !== undefined` which meant YAML's null
    // hit the non-array branch and reported "expected array, got object"
    // (because `typeof null === "object"`) — a confusing message.
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: x\ndemos: ~\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("ok");
  });

  it("reports non-nullish non-array demos with precise type (number, not 'object')", () => {
    // describeType special-cases null/array so the error message is
    // correct for the JS footgun where `typeof null === "object"` and
    // `typeof [] === "object"`. Here a number should say "got number".
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: x\ndemos: 42\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.error).toMatch(/got number/);
    }
  });

  it("returns {kind:'malformed', subkind:'shape'} when a demo entry lacks a string id", () => {
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: x\ndemos:\n  - noid: true\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/id/i);
    }
  });

  it("returns {kind:'malformed', subkind:'shape'} when deployed is present but not a boolean", () => {
    const f = path.join(root, "manifest.yaml");
    write(f, 'slug: x\ndeployed: "yes"\n');
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/deployed/i);
    }
  });

  it("returns {kind:'ok', manifest} for a valid manifest", () => {
    const f = path.join(root, "manifest.yaml");
    write(
      f,
      "slug: mypkg\nname: My Pkg\ndeployed: true\ndemos:\n  - id: foo\n    name: Foo\n  - id: bar\n",
    );
    const r = parseManifest(f);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.manifest.slug).toBe("mypkg");
      expect(r.manifest.name).toBe("My Pkg");
      expect(r.manifest.deployed).toBe(true);
      expect(r.manifest.demos?.length).toBe(2);
      expect(r.manifest.demos?.[0].id).toBe("foo");
    }
  });

  it("returns {kind:'ok', manifest} with deployed:false preserved", () => {
    // Symmetric to the deployed:true positive test above. `deployed: false`
    // is a legal boolean and must parse as {kind:"ok"} with the flag
    // preserved, not collapsed into undefined. The strict boolean guard
    // rejects stringly-typed "no", "false", etc., but a real boolean false
    // must round-trip cleanly.
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: mypkg\ndeployed: false\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.manifest.slug).toBe("mypkg");
      expect(r.manifest.deployed).toBe(false);
    }
  });

  it("returns {kind:'ok'} with an empty demos array when demos is omitted", () => {
    // `demos` is always set by parseManifest: empty readonly
    // array when the manifest omits the field, so callers can iterate
    // without `?.` chaining. The old optional-undefined shape is gone.
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: mypkg\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.manifest.demos).toEqual([]);
    }
  });

  it("returns {kind:'malformed', subkind:'shape'} when demos[i] is null", () => {
    // YAML `demos: [~]` parses to `[null]`. The per-entry object guard must
    // reject this as shape-malformed rather than crashing on `d.id` later.
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: x\ndemos:\n  - ~\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/demos\[0\].*null/i);
    }
  });

  it("returns {kind:'malformed', subkind:'shape'} when demos[i] is a scalar", () => {
    // YAML `demos: [42]` parses to `[42]`. The per-entry object guard must
    // describe the concrete scalar type in the error (not "object").
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: x\ndemos:\n  - 42\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/demos\[0\].*number/i);
    }
  });

  it("returns {kind:'malformed', subkind:'shape'} when demos[i].id is an empty string", () => {
    // Empty ids would round-trip as valid strings but make downstream
    // demo-path construction (`integrations/<slug>/src/app/demos/<id>`) collapse
    // onto the demos dir itself. Reject at validation time.
    const f = path.join(root, "manifest.yaml");
    write(f, 'slug: x\ndemos:\n  - id: ""\n');
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/demos\[0\]\.id.*non-empty/i);
    }
  });

  it("returns {kind:'malformed', subkind:'shape'} on duplicate demo ids", () => {
    // Two demos with the same id used to silently propagate — audit.ts
    // would build two missing-demo-dir anomalies for the same path and
    // validate-parity.ts would double-count coverage. Reject up-front.
    const f = path.join(root, "manifest.yaml");
    write(
      f,
      "slug: x\ndemos:\n  - id: agentic-chat\n  - id: human-in-the-loop\n  - id: agentic-chat\n",
    );
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/duplicate demo id.*agentic-chat/i);
    }
  });

  it("verifies manifest.slug matches the expected dir slug", () => {
    // parseManifest accepts an optional `dirSlug` parameter so callers
    // that derive filePath from a slug can detect drift between the
    // manifest's declared slug and the directory that holds it (copy/
    // paste error, rename-without-updating). Catch at the parser so
    // downstream tools don't silently apply the wrong slug.
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: bar-pkg\n");
    const r = parseManifest(f, "foo-pkg");
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/slug.*mismatch|mismatch.*slug/i);
      expect(r.error).toContain("foo-pkg");
      expect(r.error).toContain("bar-pkg");
    }
  });

  it("accepts a manifest where the declared slug matches dirSlug", () => {
    // Positive case for the slug-mismatch check: matching slug and
    // dirSlug should still return {kind:'ok'}.
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: mypkg\n");
    const r = parseManifest(f, "mypkg");
    expect(r.kind).toBe("ok");
  });

  it("skips the slug-mismatch check when dirSlug is omitted (backwards-compatible)", () => {
    // Callers that don't operate against the packages tree (test
    // fixtures, programmatic invocations with synthetic paths) should
    // continue to work unchanged when they don't pass dirSlug.
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: whatever\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("ok");
  });

  it("returns {kind:'malformed', subkind:'shape'} when a demo's name field is not a string", () => {
    // Prior permissive behavior silently coerced non-string `name` to
    // undefined. Match the strictness applied to top-level `name`:
    // present-but-wrong-type is a shape malformed.
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: x\ndemos:\n  - id: foo\n    name: 42\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/demos\[0\]\.name/i);
    }
  });

  it("freezes the returned manifest and its demos array", () => {
    // parseManifest must return a frozen Manifest: downstream tools
    // share the value across buckets and a mutation by one would poison
    // the rest. Both the outer object and the nested demos array must
    // be frozen.
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: x\ndemos:\n  - id: foo\n  - id: bar\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(Object.isFrozen(r.manifest)).toBe(true);
      expect(Object.isFrozen(r.manifest.demos)).toBe(true);
      expect(() => {
        (r.manifest as unknown as Record<string, unknown>)["new"] = "bogus";
      }).toThrow();
      expect(() => {
        (r.manifest.demos as unknown as unknown[])[0] = { id: "x" };
      }).toThrow();
    }
  });

  // --- demo.route validation (added by R2 fix cycle) ---------------------
  //
  // `route` is optional on each demo. When present, it must be a non-empty
  // string that begins with "/demos/". Downstream validators (validate-parity
  // routeToDirName, bundle-demo-content) rely on the "/demos/" prefix to
  // strip it uniformly; accepting a bare "/hitl" or a number silently
  // produces the wrong on-disk directory lookup.

  it("returns {kind:'malformed', subkind:'shape'} when demos[i].route is a number", () => {
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: x\ndemos:\n  - id: foo\n    route: 42\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/route/i);
    }
  });

  it("returns {kind:'malformed', subkind:'shape'} when demos[i].route is null", () => {
    // YAML `route: ~` parses to null. hasOwnProp is true but the value is
    // not a string, so the non-empty-string guard rejects it.
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: x\ndemos:\n  - id: foo\n    route: ~\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/route/i);
    }
  });

  it("returns {kind:'malformed', subkind:'shape'} when demos[i].route is an object", () => {
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: x\ndemos:\n  - id: foo\n    route:\n      nested: true\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/route/i);
    }
  });

  it("returns {kind:'malformed', subkind:'shape'} when demos[i].route is the empty string", () => {
    const f = path.join(root, "manifest.yaml");
    write(f, 'slug: x\ndemos:\n  - id: foo\n    route: ""\n');
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/route/i);
    }
  });

  it("returns {kind:'malformed', subkind:'shape'} when demos[i].route does not start with /demos/", () => {
    // Catches the exact anti-pattern the prefix guard exists for: a bare
    // "/hitl" looks route-shaped but routeToDirName's prefix strip would
    // return the whole string unchanged, then miss a real directory match.
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: x\ndemos:\n  - id: foo\n    route: /hitl\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/\/demos\//);
    }
  });

  it("returns {kind:'malformed', subkind:'shape'} when demos[i].route is exactly '/demos/'", () => {
    // The `/demos/` prefix guard accepts any string that starts with the
    // prefix, including the bare prefix with an empty tail. Downstream
    // consumers (routeToDirName, bundle-demo-content) strip the prefix and
    // expect a non-empty segment to follow; an empty tail would silently
    // point at the parent demos/ directory rather than a specific demo.
    // Reject at the parser boundary so validate-parity / bundle-demo-content
    // can treat a successful parse as a non-empty-segment invariant.
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: x\ndemos:\n  - id: foo\n    route: /demos/\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/non-empty segment/i);
    }
  });

  it("returns {kind:'ok'} and persists demo.route on the frozen entry when well-formed", () => {
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: x\ndemos:\n  - id: foo\n    route: /demos/hitl-in-chat\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      const first = r.manifest.demos?.[0];
      expect(first?.id).toBe("foo");
      expect(first?.route).toBe("/demos/hitl-in-chat");
      expect(Object.isFrozen(first)).toBe(true);
    }
  });

  it("returns {kind:'ok'} with demo.route undefined when route is omitted (backward compat)", () => {
    // Absence of `route` must not be treated as shape-malformed. Existing
    // manifests predate this field; they must still parse cleanly and the
    // frozen demo entry's .route must be undefined (not null, not a
    // placeholder).
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: x\ndemos:\n  - id: foo\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      const first = r.manifest.demos?.[0];
      expect(first?.id).toBe("foo");
      expect(first?.route).toBeUndefined();
      expect(Object.isFrozen(first)).toBe(true);
    }
  });

  it("sets demos to a frozen empty readonly array when demos is omitted", () => {
    // `demos` is non-optional in the public type: when absent, return an
    // empty readonly array so consumers can iterate without `?.` chains.
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: x\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.manifest.demos).toEqual([]);
      expect(Object.isFrozen(r.manifest.demos)).toBe(true);
    }
  });

  // --- agent mapping + per-demo runtime overrides ------------------------
  //
  // `agent_kind` / `agent_url_env` / `agent_defaults` (top level) and
  // `agent` / `runtime` (per demo) are ALL optional. The single most
  // important property is backward compatibility: every manifest written
  // before these fields existed must still parse unchanged.

  it("returns {kind:'ok'} for a manifest that declares none of the agent fields", () => {
    // Backward-compat anchor. A pre-existing manifest shape must parse
    // clean and leave every new field undefined — not defaulted, not
    // null, not a placeholder object.
    const f = path.join(root, "manifest.yaml");
    write(
      f,
      "slug: mypkg\nname: My Pkg\ndeployed: true\ndemos:\n  - id: agentic-chat\n    name: Chat\n    route: /demos/agentic-chat\n",
    );
    const r = parseManifest(f);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.manifest.agent_kind).toBeUndefined();
      expect(r.manifest.agent_url_env).toBeUndefined();
      expect(r.manifest.agent_defaults).toBeUndefined();
      const first = r.manifest.demos[0];
      expect(first?.agent).toBeUndefined();
      expect(first?.runtime).toBeUndefined();
    }
  });

  it("returns {kind:'malformed'} when agent.graph and agent.path are both set, naming slug and demo id", () => {
    // graph and path are two addressing schemes for the same agent.
    // Silently preferring one would make the ignored field look
    // effective, so the parser rejects the pair outright.
    const f = path.join(root, "manifest.yaml");
    write(
      f,
      [
        "slug: mypkg",
        "agent_kind: langgraph",
        "demos:",
        "  - id: a2ui-dynamic",
        "    agent:",
        "      graph: a2ui_dynamic",
        "      path: /subagents/agui",
        "",
      ].join("\n"),
    );
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/mutually exclusive/i);
      expect(r.error).toContain("mypkg");
      expect(r.error).toContain("a2ui-dynamic");
    }
  });

  it("returns {kind:'malformed'} when agent.graph is used under agent_kind: http", () => {
    const f = path.join(root, "manifest.yaml");
    write(
      f,
      [
        "slug: mypkg",
        "agent_kind: http",
        "demos:",
        "  - id: a2ui-dynamic",
        "    agent:",
        "      graph: a2ui_dynamic",
        "",
      ].join("\n"),
    );
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/graph.*langgraph/i);
      expect(r.error).toContain("mypkg");
      expect(r.error).toContain("a2ui-dynamic");
    }
  });

  it("returns {kind:'malformed'} when agent.graph is used with agent_kind omitted (implicit http)", () => {
    // The omitted case must behave like an explicit "http": the default
    // is http, so a graph id is just as wrong here.
    const f = path.join(root, "manifest.yaml");
    write(
      f,
      "slug: mypkg\ndemos:\n  - id: a2ui-dynamic\n    agent:\n      graph: a2ui_dynamic\n",
    );
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/langgraph/i);
    }
  });

  // ---------------------------------------------------------------------
  // MIRROR RULE: agent.path requires agent_kind: http.
  //
  // The `graph` half of this pair was checked three times over (the two tests
  // above plus an `allOf` guard in manifest.schema.json) while the `path` half
  // was checked nowhere, so a path under a non-http kind passed BOTH validators
  // and failed only at request time.
  // ---------------------------------------------------------------------

  it("returns {kind:'malformed'} when agent.path is used under agent_kind: langgraph", () => {
    const f = path.join(root, "manifest.yaml");
    write(
      f,
      [
        "slug: mypkg",
        "agent_kind: langgraph",
        "demos:",
        "  - id: agentic-chat",
        "    agent:",
        "      path: /subagents/agui",
        "",
      ].join("\n"),
    );
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/path.*http/i);
      expect(r.error).toContain("langgraph");
      // Cross-field errors must name the slug AND the demo id — a numeric
      // index alone cannot locate the entry across 20 manifests.
      expect(r.error).toContain("mypkg");
      expect(r.error).toContain("agentic-chat");
    }
  });

  it("returns {kind:'malformed'} when agent.path is used under agent_kind: in-process", () => {
    // in-process dials no URL at all (the agent is resolved by NAME through
    // IN_PROCESS_AGENT_FACTORIES), so a sub-path is inert rather than wrong-ish.
    const f = path.join(root, "manifest.yaml");
    write(
      f,
      "slug: built-in-agent\nagent_kind: in-process\ndemos:\n  - id: agentic-chat\n    agent:\n      path: /agui\n",
    );
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/path.*http/i);
      expect(r.error).toContain("in-process");
    }
  });

  it("returns {kind:'ok'} for agent.path under explicit and implicit http", () => {
    // Both spellings of "http" must stay legal: ~60 demos rely on `path`, and
    // most manifests omit `agent_kind` entirely.
    for (const body of [
      "slug: mypkg\nagent_kind: http\ndemos:\n  - id: agentic-chat\n    agent:\n      path: /agui\n",
      "slug: mypkg\ndemos:\n  - id: agentic-chat\n    agent:\n      path: /agui\n",
      // A bare "/" is the explicit spelling of the absent-path default.
      "slug: mypkg\ndemos:\n  - id: agentic-chat\n    agent:\n      path: /\n",
    ]) {
      const r = parseManifest(writeTmp(root, body));
      expect(r.kind, JSON.stringify(body)).toBe("ok");
    }
  });

  // ---------------------------------------------------------------------
  // features <-> demos[].id, BOTH directions.
  // ---------------------------------------------------------------------

  it("returns {kind:'malformed'} when a features id has no demos entry", () => {
    // THE CHECK THAT WOULD HAVE CAUGHT ALL 20 BROKEN PAIRS. resolveDemoSupport
    // returns "supported" from `features` alone, so this manifest renders
    // shared-state-read as a LIVE cell (and a static demo page for it exists),
    // then 404s at POST /api/mypkg/shared-state-read because there is no
    // demos[] row to resolve an agent from.
    const f = path.join(root, "manifest.yaml");
    write(
      f,
      [
        "slug: mypkg",
        "features:",
        "  - agentic-chat",
        "  - shared-state-read",
        "demos:",
        "  - id: agentic-chat",
        "",
      ].join("\n"),
    );
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toContain("shared-state-read");
      expect(r.error).toContain("mypkg");
      expect(r.error).toMatch(/features/);
      expect(r.error).toMatch(/demos/);
      // The wired id must NOT be blamed.
      expect(r.error).not.toContain("agentic-chat");
    }
  });

  it("does not accept not_supported_features as a substitute for a demos entry", () => {
    // `not_supported_features` satisfies the FORWARD direction (a demos row may
    // be declared there instead of in `features`). It must not satisfy the
    // reverse one: an id in `features` is what makes the cell live, and listing
    // it in both lists does not conjure a demos row.
    const f = path.join(root, "manifest.yaml");
    write(
      f,
      [
        "slug: mypkg",
        "features:",
        "  - shared-state-read",
        "not_supported_features:",
        "  - shared-state-read",
        "demos: []",
        "",
      ].join("\n"),
    );
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toContain("shared-state-read");
    }
  });

  it("returns {kind:'ok'} when every features id has a demos entry", () => {
    const f = path.join(root, "manifest.yaml");
    write(
      f,
      [
        "slug: mypkg",
        "features:",
        "  - agentic-chat",
        "  - cli-start",
        "not_supported_features:",
        "  - gen-ui-interrupt",
        "demos:",
        "  - id: agentic-chat",
        "    route: /demos/agentic-chat",
        // Informational demo: `command` instead of `route`, and no on-disk
        // folder. It still carries a demos[] row, which is why the reverse
        // check needs no informational exemption.
        "  - id: cli-start",
        "    command: npx degit copilotkit/starter",
        // Declared non-supported ids are exempt from the reverse check: they
        // are not in `features`, so no cell claims to be live.
        "  - id: gen-ui-interrupt",
        "    route: /demos/gen-ui-interrupt",
        "",
      ].join("\n"),
    );
    const r = parseManifest(f);
    expect(r.kind).toBe("ok");
  });

  it("skips both features<->demos directions when features is absent", () => {
    // "Did not say" (test fixtures, pre-schema manifests). The JSON schema makes
    // `features` required with minItems: 1 for real manifests, so skipping here
    // does not weaken the gate.
    const r = parseManifest(
      writeTmp(root, "slug: mypkg\ndemos:\n  - id: agentic-chat\n"),
    );
    expect(r.kind).toBe("ok");
  });

  // ---------------------------------------------------------------------
  // EVERY DEMO ROW MUST BE REACHABLE: route (a page) or command (an
  // informational cell).
  //
  // A row carrying only { id, name, description, tags } passed this parser,
  // the frontend's assertManifest AND the JSON schema, and then 404ed at
  // request time: no route means no page and no on-disk folder, no command
  // means nothing to display instead. Gated on a declared `features` key,
  // like the two cross-field checks above, so fixture manifests that predate
  // the schema (audit / validate-parity tests write dozens of them) still
  // parse.
  // ---------------------------------------------------------------------

  it("returns {kind:'malformed'} for a demo with neither route nor command", () => {
    const f = path.join(root, "manifest.yaml");
    write(
      f,
      [
        "slug: mypkg",
        "features:",
        "  - agentic-chat",
        "demos:",
        "  - id: agentic-chat",
        "    name: Chat",
        "",
      ].join("\n"),
    );
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toContain("agentic-chat");
      expect(r.error).toContain("mypkg");
      // Names BOTH repairs, because which one is right depends on the demo.
      expect(r.error).toMatch(/route/);
      expect(r.error).toMatch(/command/);
    }
  });

  it("accepts a command-only row (informational) and a route-only row", () => {
    // The two legal spellings. `cli-start` is command-only in all 20 real
    // manifests; everything else is route-only.
    const r = parseManifest(
      writeTmp(
        root,
        [
          "slug: mypkg",
          "features:",
          "  - agentic-chat",
          "  - cli-start",
          "demos:",
          "  - id: agentic-chat",
          "    route: /demos/agentic-chat",
          "  - id: cli-start",
          "    command: npx copilotkit@latest init",
          "",
        ].join("\n"),
      ),
    );
    expect(r.kind).toBe("ok");
  });

  it("skips the route/command requirement when features is absent", () => {
    // The fixture-compat gate, pinned: audit.test.ts / validate-parity.test.ts
    // write dozens of `demos:\n  - id: chat` manifests with no `features` key,
    // and the JSON schema (where `features` is required) carries the matching
    // `anyOf` for real manifests.
    const r = parseManifest(
      writeTmp(root, "slug: mypkg\ndemos:\n  - id: chat\n    name: Chat\n"),
    );
    expect(r.kind).toBe("ok");
  });

  it("rejects a route the JSON schema rejects — '/demos/' + newline", () => {
    // THE REVERSE SPLIT GATE. The schema pattern is `^/demos/.` and `.` never
    // matches a line terminator, so the schema REJECTED this while the parser
    // accepted it: it starts with the prefix and is 8 characters long. One
    // validator's verdict depended on which validator ran.
    const r = parseManifest(
      writeTmp(root, 'slug: x\ndemos:\n  - id: foo\n    route: "/demos/\\n"\n'),
    );
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/route/i);
    }
  });

  it("deep-freezes agent_defaults, agent.config and demos[].runtime", () => {
    // `Object.freeze` is SHALLOW, so one `Object.freeze({ ...block })` left
    // every value below the first level mutable — while the docstrings promised
    // a deep freeze and a consumer mutating a nested option in place would
    // change what a second consumer, holding the same parsed manifest, reads.
    const f = path.join(root, "manifest.yaml");
    write(
      f,
      [
        "slug: mypkg",
        "agent_defaults:",
        "  nested:",
        "    limit: 100",
        "demos:",
        "  - id: mcp-apps",
        "    route: /demos/mcp-apps",
        "    agent:",
        "      config:",
        "        nested:",
        "          limit: 25",
        "    runtime:",
        "      mcpApps:",
        "        servers:",
        "          - serverId: excalidraw",
        "",
      ].join("\n"),
    );
    const r = parseManifest(f);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    const defaults = r.manifest.agent_defaults as { nested: object };
    expect(Object.isFrozen(defaults.nested)).toBe(true);
    const config = r.manifest.demos[0]?.agent?.config as { nested: object };
    expect(Object.isFrozen(config.nested)).toBe(true);
    const runtime = r.manifest.demos[0]?.runtime as {
      mcpApps: { servers: object[] };
    };
    expect(Object.isFrozen(runtime.mcpApps)).toBe(true);
    expect(Object.isFrozen(runtime.mcpApps.servers)).toBe(true);
    expect(Object.isFrozen(runtime.mcpApps.servers[0])).toBe(true);
    expect(() => {
      (runtime.mcpApps.servers[0] as Record<string, unknown>).serverId = "x";
    }).toThrow();
  });

  it("returns {kind:'ok'} for a langgraph manifest with a per-demo graph", () => {
    const f = path.join(root, "manifest.yaml");
    write(
      f,
      [
        "slug: langgraph-python",
        "agent_kind: langgraph",
        "agent_url_env: LANGGRAPH_URL",
        "agent_defaults:",
        "  recursion_limit: 100",
        "demos:",
        "  - id: a2ui-dynamic",
        "    agent:",
        "      graph: a2ui_dynamic",
        "      name: dynamic_agent",
        "      config:",
        "        recursion_limit: 25",
        "",
      ].join("\n"),
    );
    const r = parseManifest(f);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.manifest.agent_kind).toBe("langgraph");
      expect(r.manifest.agent_url_env).toBe("LANGGRAPH_URL");
      expect(r.manifest.agent_defaults).toEqual({ recursion_limit: 100 });
      const agent = r.manifest.demos[0]?.agent;
      expect(agent?.graph).toBe("a2ui_dynamic");
      expect(agent?.name).toBe("dynamic_agent");
      expect(agent?.path).toBeUndefined();
      // Per-demo agent-construction override of agent_defaults. NOT a
      // `runtime` key — `runtime` is CopilotRuntime options only.
      expect(agent?.config).toEqual({ recursion_limit: 25 });
      expect(Object.isFrozen(agent?.config)).toBe(true);
      expect(Object.isFrozen(agent)).toBe(true);
    }
  });

  it("accepts agent.config on an http demo with no graph", () => {
    // `agent.config` is agent-construction config for ANY framework; it
    // is not langgraph-only and does not require `agent.graph`.
    const f = path.join(root, "manifest.yaml");
    write(
      f,
      [
        "slug: mypkg",
        "demos:",
        "  - id: agentic-chat",
        "    agent:",
        "      config:",
        "        maxSteps: 12",
        "",
      ].join("\n"),
    );
    const r = parseManifest(f);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.manifest.demos[0]?.agent?.config).toEqual({ maxSteps: 12 });
      expect(r.manifest.demos[0]?.agent?.graph).toBeUndefined();
    }
  });

  it("returns {kind:'malformed'} when agent.config is not a mapping", () => {
    const f = path.join(root, "manifest.yaml");
    write(
      f,
      [
        "slug: mypkg",
        "demos:",
        "  - id: d1",
        "    agent:",
        "      config: 42",
        "",
      ].join("\n"),
    );
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/agent\.config.*number/i);
      expect(r.error).toContain("mypkg");
      expect(r.error).toContain("d1");
    }
  });

  it("returns {kind:'ok'} for an http manifest with a per-demo path and runtime overrides", () => {
    const f = path.join(root, "manifest.yaml");
    write(
      f,
      [
        "slug: mypkg",
        "agent_kind: http",
        "demos:",
        "  - id: a2ui-dynamic",
        "    agent:",
        "      path: /subagents/agui",
        "    runtime:",
        "      a2ui:",
        "        injectA2UITool: false",
        "",
      ].join("\n"),
    );
    const r = parseManifest(f);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      const demo = r.manifest.demos[0];
      expect(demo?.agent?.path).toBe("/subagents/agui");
      expect(demo?.agent?.graph).toBeUndefined();
      expect(demo?.runtime).toEqual({ a2ui: { injectA2UITool: false } });
      expect(Object.isFrozen(demo?.runtime)).toBe(true);
    }
  });

  it("returns {kind:'malformed'} for an unknown agent_kind", () => {
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: mypkg\nagent_kind: grpc\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/agent_kind/i);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // demo_frontend — the single tracked source of truth for the unified-frontend
  // migration. Every consumer derives from it, so a value that parses wrong (or
  // a bad value that parses at all) propagates into the compose roster and the
  // harness's origin resolution at once.
  // ─────────────────────────────────────────────────────────────────────────
  it("parses demo_frontend: unified", () => {
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: mypkg\ndemo_frontend: unified\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.manifest.demo_frontend).toBe("unified");
      expect(demoFrontendOf(r.manifest)).toBe("unified");
    }
  });

  it("parses demo_frontend: integration", () => {
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: mypkg\ndemo_frontend: integration\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.manifest.demo_frontend).toBe("integration");
      expect(demoFrontendOf(r.manifest)).toBe("integration");
    }
  });

  it("leaves demo_frontend undefined when absent, and demoFrontendOf defaults it", () => {
    // The parsed value stays round-trippable (same policy as agent_kind), but
    // no CONSUMER sees a third "did not say" state — demoFrontendOf collapses
    // it once, in one place.
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: mypkg\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.manifest.demo_frontend).toBeUndefined();
      expect(demoFrontendOf(r.manifest)).toBe(DEFAULT_DEMO_FRONTEND);
      expect(DEFAULT_DEMO_FRONTEND).toBe("integration");
    }
  });

  it("returns {kind:'malformed'} for an unknown demo_frontend", () => {
    // A typo must not silently read as un-migrated: that is exactly the
    // half-migrated state (demos served by one frontend, everything else
    // believing the other) that this field exists to make impossible.
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: mypkg\ndemo_frontend: unifed\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/demo_frontend/i);
      expect(r.error).toMatch(/integration \| unified/);
    }
  });

  it("returns {kind:'malformed'} when demo_frontend is not a string", () => {
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: mypkg\ndemo_frontend: true\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.error).toMatch(/demo_frontend.*boolean/i);
    }
  });

  it("DEMO_FRONTENDS matches the schema's demo_frontend enum exactly", () => {
    // Same pin as AGENT_KINDS: JSON cannot import TypeScript, so the schema
    // copy cannot be deleted. generate-registry.ts enforces this at build time
    // via assertSchemaDemoFrontendsMatch; this is the unit-level mirror.
    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf-8")) as {
      properties: { demo_frontend: { enum: string[]; default: string } };
    };
    expect([...schema.properties.demo_frontend.enum].sort()).toEqual(
      [...DEMO_FRONTENDS].sort(),
    );
    // And the schema's declared default must be the one the parser applies, or
    // schema-driven tooling would materialise a different answer than the code.
    expect(schema.properties.demo_frontend.default).toBe(DEFAULT_DEMO_FRONTEND);
  });

  it("composePublicUrlFor derives the container URL for each value", () => {
    expect(composePublicUrlFor("mastra", "integration")).toBe(
      "http://mastra:10000",
    );
    // The /<slug> segment is load-bearing: consumers append /demos/<id>.
    expect(composePublicUrlFor("mastra", "unified")).toBe(
      "http://frontend-nextjs:3000/mastra",
    );
  });

  it("every real manifest declares a demo_frontend the parser accepts", () => {
    // The field IS the tracked state; a manifest that omits it hides the axis
    // from anyone reading the file, even though the default would cover it.
    //
    // The per-slug value is PINNED, not merely "one of the two". A migration
    // must be a deliberate, live-verified edit: if this goes red, someone
    // changed a slug's demo_frontend and owes a full D6 matrix run through the
    // default fleet path before updating MIGRATED_SLUGS below.
    //
    // langgraph-python: migrated and verified live (41-cell D6 matrix, demos
    // served from the unified app at <origin>/langgraph-python/demos/*, agent
    // still on the integration's own container origin).
    //
    // built-in-agent: migrated and verified live (41-cell D6 matrix before AND
    // after the flip, both through the default fleet path; 30 green / 7 red /
    // 4 skipped-incapable in BOTH runs, zero regressions). Its `agent_kind` is
    // `in-process`, so the agent axis is nominal once migrated — the runtime
    // requests were observed on frontend-nextjs:3000/api/built-in-agent/<demo>,
    // the same origin as the demo pages.
    //
    // mastra: migrated and verified live (43-cell D6 matrix before AND after
    // the flip, the largest matrix). Baseline 34 green / 9 red / 0 skipped;
    // migrated 35 green / 8 red / 0 skipped — zero regressions, one
    // fail -> pass (hitl-approve-deny). `agent_kind: http`, so the agent axis
    // stayed on the integration's own origin (the unified runtime route proxies
    // to AGENT_URL_MASTRA = http://mastra:8000).
    //
    // ms-agent-python: migrated and verified live (40-cell D6 matrix before AND
    // after the flip, both through the default fleet path). 34 green / 4 red /
    // 2 skipped-incapable in BOTH runs, zero regressions, and all four
    // pre-existing reds (gen-ui-agent, gen-ui-declarative, multimodal,
    // tool-rendering-reasoning-chain) failed with BYTE-IDENTICAL error strings
    // — checked, not assumed. `agent_kind: http`, so the agent axis stayed on
    // the integration's own origin: the pages moved to
    // frontend-nextjs:3000/ms-agent-python/demos/*, whose runtime route proxies
    // server-side to AGENT_URL_MS_AGENT_PYTHON (http://ms-agent-python:8000) —
    // verified by observing the agent POSTs still arriving at the
    // ms-agent-python container.
    //
    // strands: migrated and verified live (40-cell D6 matrix before AND after
    // the flip, both through the default fleet path). 32 green / 4 red / 4
    // skipped-incapable in BOTH runs, zero regressions. Three of the four
    // pre-existing reds (gen-ui-agent, gen-ui-headless-complete, multimodal)
    // failed with byte-identical strings. The fourth, frontend-tools, did NOT:
    // same failure mode and reason code (`waitForTurnComplete` timeout at
    // 60000ms, reason=done-signal-missing, count=10) but the run counters
    // differ (runsFinished 49 -> 48, runStartCount 50 -> 49). That is
    // run-to-run jitter in the same wedged-stream failure, not a new failure
    // wearing an old one's clothes — recorded here rather than normalised away
    // so the next reader can re-judge it instead of trusting this note.
    // `agent_kind: http`, so the agent axis stayed on the integration's own
    // origin (AG-UI POSTs still observed arriving at the strands container).
    //
    // spring-ai: migrated and verified live (38-cell D6 matrix before AND after
    // the flip, both through the default fleet path). 29 green / 6 red / 3
    // skipped-incapable in BOTH runs, zero regressions, and ALL SIX
    // pre-existing reds (gen-ui-agent, gen-ui-declarative,
    // gen-ui-headless-complete, mcp-apps, multimodal, shared-state-streaming)
    // failed with BYTE-IDENTICAL error strings — compared, not assumed.
    // The only JVM cell in the fleet: `agent_kind: http`, so the agent axis
    // stayed on the integration's own container, where the Spring Boot
    // AimockHeaderInterceptor logged the inbound AG-UI POSTs on port 8000
    // while the demo pages were served from
    // frontend-nextjs:3000/spring-ai/demos/*.
    //
    // NOTE on this slug's `not_supported_features`: it declares FIVE entries
    // but only THREE become skipped cells. `not_supported_features` is matched
    // against D5 FEATURE TYPES (see `incapableSet` in
    // `harness/src/probes/drivers/d6-all-pills.ts`), not against demo ids, so
    // `reasoning-default-render` and `agentic-chat-reasoning` are INERT — no
    // D5 feature type carries either name. Do not read the count as a bug in
    // the skip logic; the skip count and the NSF count are not the same fact.
    //
    // ms-agent-dotnet: migrated and verified live (41-cell D6 matrix before
    // AND after the flip, both through the default fleet path). 34 green /
    // 5 red / 2 skipped-incapable in BOTH runs, zero regressions.
    // reasoning-display stayed GREEN: the unified runtime applies
    // `frontends/nextjs/src/lib/reasoning-shim.ts` because this manifest lists
    // reasoning-default, reasoning-custom, and
    // tool-rendering-reasoning-chain under `synthetic_reasoning_demos`.
    // All five pre-existing reds failed with BYTE-IDENTICAL error strings.
    // `agent_kind: http`. Pages moved to
    // frontend-nextjs:3000/ms-agent-dotnet/demos/*.
    //
    // ms-agent-harness-dotnet: migrated and verified live (40-cell D6 matrix
    // before AND after the flip). 32 green / 5 red / 3 skipped-incapable in
    // BOTH runs, zero regressions. Same synthetic reasoning list.
    // reasoning-display stayed GREEN. All five pre-existing reds failed with
    // BYTE-IDENTICAL error strings. `agent_kind: http`.
    //
    // strands-typescript: migrated and verified live (40-cell D6 matrix
    // before AND after the flip). 32 green / 4 red / 4 skipped-incapable in
    // BOTH runs, zero regressions. gen-ui-agent and multimodal were
    // byte-identical. frontend-tools kept reason=done-signal-missing with
    // count 10 -> 11. gen-ui-headless-complete stayed red but swapped
    // assertion (text-unstable turn 3 -> missing headless-revenue-chart).
    // Not an aimock-miss sweep. Did not port forwardingProxyFetch.
    // `agent_kind: http`.
    //
    // agno: migrated and verified live (39-cell D6 matrix before AND after
    // the flip). 24 green / 11 red / 4 skipped-incapable in BOTH runs,
    // zero regressions. None of the nine lift cells went green from the
    // page move alone. `agent_kind: http`.
    //
    // claude-sdk-python: migrated and verified live (40-cell D6 matrix
    // before AND after the flip). 36 green / 2 red / 2 skipped-incapable
    // in BOTH runs, zero regressions. Same two reds (gen-ui-agent,
    // tool-rendering-reasoning-chain). `agent_kind: http`.
    //
    // google-adk: migrated and verified live (40-cell D6 matrix before
    // AND after the flip). 37 green / 3 red / 0 skipped-incapable in BOTH
    // runs. Counts match; red set does not. multimodal lifted after the
    // frontend-nextjs sample.png rebuild. New red: gen-ui-interrupt
    // (confirmed on a single-cell re-run). `agent_kind: http`.
    //
    // langgraph-fastapi: migrated and verified live (41-cell D6 matrix
    // before AND after the flip). Baseline 37 / 2 / 2; migrated 36 / 3 / 2.
    // New red: a2ui-recovery (confirmed on a single-cell re-run).
    // `agent_kind: langgraph`.
    //
    // ag2: migrated and verified live (37-cell D6). Baseline 31 / 2 / 4;
    // migrated 32 / 1 / 4. Zero regressions. multimodal lifted after
    // the frontend-nextjs sample.png rebuild. Remaining red:
    // gen-ui-agent (fleet fixture). `agent_kind: http`.
    //
    // pydantic-ai: migrated and verified live (40-cell D6). Baseline
    // 33 / 3 / 4; migrated 34 / 2 / 4. Zero regressions. multimodal
    // lifted the same way. Remaining reds: gen-ui-agent,
    // reasoning-display. `agent_kind: http`.
    //
    // claude-sdk-typescript: migrated and verified live (40-cell D6).
    // 35 / 3 / 2 in BOTH runs, zero regressions. Same three reds.
    // `agent_kind: http`.
    //
    // langgraph-typescript: migrated and verified live (41-cell D6).
    // 36 / 3 / 2 in BOTH runs, zero regressions. Same three reds.
    // `agent_kind: langgraph`.
    //
    // crewai-crews: last remaining integration-frontend wave, flipped
    // with langroid and llamaindex. 38-cell baseline 25 / 7 / 6.
    // Flip-only; D6 after flip not run here. Implicit `agent_kind: http`.
    //
    // langroid: same wave. 38-cell baseline 27 / 6 / 5.
    // Implicit `agent_kind: http`.
    //
    // llamaindex: same wave. 39-cell baseline 28 / 6 / 5.
    // Implicit `agent_kind: http`.
    const MIGRATED_SLUGS = new Set([
      "ag2",
      "agno",
      "built-in-agent",
      "claude-sdk-python",
      "claude-sdk-typescript",
      "crewai-crews",
      "google-adk",
      "langgraph-fastapi",
      "langgraph-python",
      "langgraph-typescript",
      "langroid",
      "llamaindex",
      "mastra",
      "ms-agent-dotnet",
      "ms-agent-harness-dotnet",
      "ms-agent-python",
      "pydantic-ai",
      "spring-ai",
      "strands",
      "strands-typescript",
    ]);
    const integrationsDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../integrations",
    );
    const slugs = fs
      .readdirSync(integrationsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
      .map((e) => e.name);
    expect(slugs.length).toBeGreaterThan(0);
    // The pin only bites while every named slug actually exists.
    for (const slug of MIGRATED_SLUGS) expect(slugs).toContain(slug);
    for (const slug of slugs) {
      const r = parseManifest(
        path.join(integrationsDir, slug, "manifest.yaml"),
        slug,
      );
      expect(r.kind, slug).toBe("ok");
      if (r.kind === "ok") {
        expect(r.manifest.demo_frontend, slug).toBeDefined();
        expect(demoFrontendOf(r.manifest), slug).toBe(
          MIGRATED_SLUGS.has(slug) ? "unified" : "integration",
        );
      }
    }
  });

  it("returns {kind:'malformed'} when agent_url_env is the empty string", () => {
    // `process.env[""]` is always undefined, so an empty name silently
    // degrades to "no agent URL" instead of failing.
    const f = path.join(root, "manifest.yaml");
    write(f, 'slug: mypkg\nagent_url_env: ""\n');
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.error).toMatch(/agent_url_env/i);
    }
  });

  it("returns {kind:'malformed'} when agent_defaults is not a mapping", () => {
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: mypkg\nagent_defaults: 42\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.error).toMatch(/agent_defaults.*number/i);
    }
  });

  it("returns {kind:'ok'} for a bare agent.path of '/'", () => {
    // Five integrations (ag2, ms-agent-harness-dotnet, spring-ai,
    // crewai-crews, langroid) mount their shared agent at exactly
    // `${AGENT_URL}/`, so "/" is the natural transcription. An earlier
    // revision required a non-empty segment after the slash, which
    // forced those demos to carry no `agent:` block at all.
    const f = path.join(root, "manifest.yaml");
    write(f, 'slug: mypkg\ndemos:\n  - id: foo\n    agent:\n      path: "/"\n');
    const r = parseManifest(f);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.manifest.demos[0]?.agent?.path).toBe("/");
    }
  });

  it("returns {kind:'malformed'} when agent.path does not start with a slash", () => {
    const f = path.join(root, "manifest.yaml");
    write(
      f,
      "slug: mypkg\ndemos:\n  - id: foo\n    agent:\n      path: subagents/agui\n",
    );
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.error).toMatch(/agent\.path/i);
    }
  });

  it("returns {kind:'malformed'} when agent.name is not a string", () => {
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: mypkg\ndemos:\n  - id: foo\n    agent:\n      name: 42\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.error).toMatch(/agent\.name/i);
    }
  });

  it("returns {kind:'malformed'} when demos[i].agent is not a mapping", () => {
    // Only the nested `agent.config: 42` case was covered. `agent: 42` (a
    // mis-indented block, so the whole mapping collapses to a scalar) took a
    // different branch — the one that runs BEFORE any per-key check — and had
    // no test. The error must name the slug and demo id, like its siblings.
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: mypkg\ndemos:\n  - id: d1\n    agent: 42\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/demos\[0\]\.agent.*number/i);
      expect(r.error).toContain("mypkg");
      expect(r.error).toContain("d1");
    }
  });

  it("returns {kind:'malformed'} when agent_kind is not a string", () => {
    // The unknown-string case (`agent_kind: grpc`) was covered, the
    // non-string one was not, and they take different halves of the same
    // condition — a number would otherwise have to be reported by the
    // `"${candidate}"` branch that assumes a string.
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: mypkg\nagent_kind: 42\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/agent_kind/i);
      expect(r.error).toMatch(/number/);
    }
  });

  // --- backend_url ------------------------------------------------------
  //
  // capture-previews.ts navigates to this URL. It is optional, but an empty
  // string is worse than absent: the caller's `if (manifest.backend_url)`
  // check reads the same as "not deployed", while a typo'd `backend_url: ~`
  // looks set in the YAML.

  it("returns {kind:'ok'} and preserves a well-formed backend_url", () => {
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: mypkg\nbackend_url: https://mypkg.up.railway.app\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.manifest.backend_url).toBe("https://mypkg.up.railway.app");
    }
  });

  it("returns {kind:'ok'} with backend_url undefined when it is omitted", () => {
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: mypkg\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.manifest.backend_url).toBeUndefined();
    }
  });

  it("returns {kind:'malformed'} when backend_url is not a string", () => {
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: mypkg\nbackend_url: 42\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/backend_url.*number/i);
    }
  });

  it("returns {kind:'malformed'} when backend_url is the empty string", () => {
    const f = path.join(root, "manifest.yaml");
    write(f, 'slug: mypkg\nbackend_url: ""\n');
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/backend_url/i);
    }
  });

  // --- demos[i].command -------------------------------------------------
  //
  // `command` is what marks a demo INFORMATIONAL (e.g. cli-start): parity
  // and bundling skip such demos because they have no on-disk folder. An
  // unvalidated field here decides whether a demo is expected to exist.

  it("returns {kind:'ok'} and preserves demos[i].command", () => {
    const f = path.join(root, "manifest.yaml");
    write(
      f,
      "slug: mypkg\ndemos:\n  - id: cli-start\n    command: npx copilotkit@latest init\n",
    );
    const r = parseManifest(f);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.manifest.demos[0]?.command).toBe("npx copilotkit@latest init");
      expect(Object.isFrozen(r.manifest.demos[0])).toBe(true);
    }
  });

  it("returns {kind:'ok'} with command undefined when it is omitted", () => {
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: mypkg\ndemos:\n  - id: foo\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.manifest.demos[0]?.command).toBeUndefined();
    }
  });

  it("returns {kind:'malformed'} when demos[i].command is not a string", () => {
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: mypkg\ndemos:\n  - id: foo\n    command: 42\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/demos\[0\]\.command.*number/i);
    }
  });

  it("returns {kind:'malformed'} when demos[i].command is the empty string", () => {
    // An empty command would render an empty "copy this" row in the
    // dashboard while still marking the demo informational, so parity
    // silently stops expecting a folder for a demo that has neither.
    const f = path.join(root, "manifest.yaml");
    write(f, 'slug: mypkg\ndemos:\n  - id: foo\n    command: ""\n');
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/demos\[0\]\.command/i);
    }
  });

  // --- explicit-null policy ---------------------------------------------

  it("rejects an explicit null for every field except top-level demos", () => {
    // THE POLICY, pinned. YAML `~` is an easy authoring slip and the parser
    // treats it in exactly two ways:
    //
    //   - top-level `demos: ~` is ACCEPTED as "no demos declared", because
    //     the field is a collection whose absence is normal and a null there
    //     has one obvious meaning (the guard is `obj.demos != null`);
    //   - every other field REJECTS null, because a null value there is
    //     indistinguishable from a typo and defaulting it would silently
    //     drop what the author meant to say.
    //
    // Both halves are asserted together so a future change cannot make one
    // lenient without a test noticing.
    //
    // `features` and `not_supported_features` are listed EXPLICITLY below.
    // They used to be missing from this loop while `parseFeatureIdList`
    // treated `obj[key] == null` as "not declared" — so this test asserted a
    // policy the parser did not have, precisely where it did not have it.
    // That gap was not cosmetic: all three cross-field checks are gated on
    // `features !== undefined`, so `features: ~` silently switched off the
    // features→demos check, the demos→features check AND the route/command
    // reachability check at once. The last body below is that exact manifest.
    expect(parseManifest(writeTmp(root, "slug: x\ndemos: ~\n")).kind).toBe(
      "ok",
    );
    for (const body of [
      "slug: x\nname: ~\n",
      "slug: x\ndeployed: ~\n",
      "slug: x\nbackend_url: ~\n",
      "slug: x\nfeatures: ~\n",
      "slug: x\nnot_supported_features: ~\n",
      "slug: x\nfeatures: ~\ndemos:\n  - id: foo\n",
      "slug: x\ndemos:\n  - ~\n",
      "slug: x\ndemos:\n  - id: foo\n    route: ~\n",
      "slug: x\ndemos:\n  - id: foo\n    command: ~\n",
      "slug: x\ndemos:\n  - id: foo\n    agent: ~\n",
      "slug: x\ndemos:\n  - id: foo\n    runtime: ~\n",
    ]) {
      const r = parseManifest(writeTmp(root, body));
      expect(r.kind, JSON.stringify(body)).toBe("malformed");
    }
  });

  it("distinguishes an ABSENT feature list from an explicit null and from []", () => {
    // The three states must stay distinguishable, because they mean three
    // different things to the cross-field checks:
    //
    //   absent      -> "did not say"; the checks are skipped (test fixtures,
    //                  pre-schema manifests). Value stays `undefined`.
    //   `~` (null)  -> REJECTED. See the policy test above.
    //   `[]`        -> declared-and-empty; the checks RUN, so a demos[] row
    //                  with no matching feature id is caught.
    //
    // Asserting all three together is what makes the null rejection load-
    // bearing rather than incidental: if a future change re-collapses null
    // into "absent", the middle case flips to "ok" and this fails.
    const absent = parseManifest(writeTmp(root, "slug: x\n"));
    expect(absent.kind).toBe("ok");
    if (absent.kind === "ok") {
      expect(absent.manifest.features).toBeUndefined();
      expect(absent.manifest.not_supported_features).toBeUndefined();
    }

    // Absent `features` + a demos row => checks skipped => ok.
    expect(
      parseManifest(writeTmp(root, "slug: x\ndemos:\n  - id: foo\n")).kind,
    ).toBe("ok");

    // Explicit null is rejected, and the message says so rather than falling
    // through to the generic "got null" shape error.
    const nulled = parseManifest(writeTmp(root, "slug: x\nfeatures: ~\n"));
    expect(nulled.kind).toBe("malformed");
    if (nulled.kind === "malformed") {
      expect(nulled.subkind).toBe("shape");
      expect(nulled.error).toMatch(/features/);
      expect(nulled.error).toMatch(/explicit null/i);
    }

    // `features: []` declares the key, so the demos→features check RUNS and
    // catches the unlisted row. This is the assertion that proves the gate is
    // driven by "declared", not by "non-empty".
    const emptyList = parseManifest(
      writeTmp(root, "slug: x\nfeatures: []\ndemos:\n  - id: foo\n"),
    );
    expect(emptyList.kind).toBe("malformed");
    if (emptyList.kind === "malformed") {
      expect(emptyList.error).toMatch(/foo/);
    }
  });

  it("leaves an omitted agent_url_env undefined rather than defaulting it", () => {
    // There is no DEFAULT_AGENT_URL_ENV constant any more (the field is dead —
    // agent-resolution.ts reads AGENT_URL_<SLUG> and only that), and the parser
    // substitutes nothing. Leaving the field undefined is what lets a consumer
    // tell "declared AGENT_URL" from "did not say", and keeps the parsed
    // manifest round-trippable back to YAML.
    const omitted = parseManifest(writeTmp(root, "slug: mypkg\n"));
    expect(omitted.kind).toBe("ok");
    if (omitted.kind === "ok") {
      expect(omitted.manifest.agent_url_env).toBeUndefined();
    }
    const declared = parseManifest(
      writeTmp(root, "slug: mypkg\nagent_url_env: AGENT_URL\n"),
    );
    expect(declared.kind).toBe("ok");
    if (declared.kind === "ok") {
      expect(declared.manifest.agent_url_env).toBe("AGENT_URL");
    }
  });

  it("returns {kind:'ok'} for a scalar runtime option value (openGenerativeUI: true)", () => {
    // Regression guard: an earlier revision required every runtime
    // option value to be an object, which rejected `openGenerativeUI:
    // true` — a real value used by strands-typescript,
    // claude-sdk-typescript and agno. Option values are passed through
    // to CopilotRuntime untouched and must NOT be shape-checked.
    const f = path.join(root, "manifest.yaml");
    write(
      f,
      "slug: mypkg\ndemos:\n  - id: foo\n    runtime:\n      openGenerativeUI: true\n",
    );
    const r = parseManifest(f);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.manifest.demos[0]?.runtime).toEqual({ openGenerativeUI: true });
    }
  });

  it("returns {kind:'ok'} for mixed runtime option value types on one demo", () => {
    // The same option name takes different types across integrations
    // (`openGenerativeUI` is `true` in strands-typescript but
    // `{ agents: [...] }` in ag2), and a single demo mixes booleans,
    // objects and nested arrays. All must round-trip untouched.
    const f = path.join(root, "manifest.yaml");
    write(
      f,
      [
        "slug: mypkg",
        "demos:",
        "  - id: foo",
        "    runtime:",
        "      openGenerativeUI:",
        "        agents:",
        "          - beautiful-chat",
        "      a2ui:",
        "        injectA2UITool: false",
        "        defaultCatalogId: copilotkit://app-dashboard-catalog",
        "      mcpApps:",
        "        servers:",
        "          - name: demo",
        "",
      ].join("\n"),
    );
    const r = parseManifest(f);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.manifest.demos[0]?.runtime).toEqual({
        openGenerativeUI: { agents: ["beautiful-chat"] },
        a2ui: {
          injectA2UITool: false,
          defaultCatalogId: "copilotkit://app-dashboard-catalog",
        },
        mcpApps: { servers: [{ name: "demo" }] },
      });
    }
  });

  it("returns {kind:'malformed'} when runtime itself is not a mapping", () => {
    // The top-level `runtime` block must still be a mapping — a scalar
    // there means the author mis-indented, and every consumer would
    // TypeError iterating it. Only the option VALUES are unvalidated.
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: mypkg\ndemos:\n  - id: foo\n    runtime: 42\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/runtime.*number/i);
    }
  });

  it.skipIf(cannotEnforceEacces)(
    "returns {kind:'unreadable'} when the parent dir is unreadable (EACCES on stat)",
    () => {
      // Regression for FX30-C Fix 2 (R29-2 H3): parseManifest used
      // fs.existsSync which CONFLATES ENOENT with EACCES — a manifest
      // whose parent dir is 0700 owned by another user collapses to
      // "missing" instead of surfacing as "unreadable". That's the
      // exact anti-pattern probeDir in validate-parity.ts was written
      // to avoid. parseManifest must use statSync + errno inspection
      // so EACCES/ENOTDIR/etc route to `{kind:"unreadable"}`.
      const eaccesRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "lib-manifest-parent-eacces-"),
      );
      const parentDir = path.join(eaccesRoot, "locked");
      fs.mkdirSync(parentDir);
      const manifestFile = path.join(parentDir, "manifest.yaml");
      fs.writeFileSync(manifestFile, "slug: ok\n");
      fs.chmodSync(parentDir, 0o000);
      try {
        const r = parseManifest(manifestFile);
        expect(r.kind).toBe("unreadable");
      } finally {
        try {
          fs.chmodSync(parentDir, 0o755);
        } catch {
          // best-effort
        }
        fs.rmSync(eaccesRoot, { recursive: true, force: true });
      }
    },
  );

  it("returns {kind:'unreadable'} when statSync throws a non-ENOENT errno", () => {
    // Deterministic variant of the chmod-based test above: stub statSync
    // to throw EACCES so the behavior is verified even on FS layers that
    // ignore chmod. Pre-ENOENT semantics (via fs.existsSync) would have
    // collapsed this to {kind:"missing"}.
    const tmp = fs.mkdtempSync(
      path.join(os.tmpdir(), "lib-manifest-stat-spy-"),
    );
    const f = path.join(tmp, "manifest.yaml");
    fs.writeFileSync(f, "slug: ok\n");
    const orig = fs.statSync;
    const spy = vi.spyOn(fs, "statSync").mockImplementation(((
      p: fs.PathLike,
      options?: unknown,
    ) => {
      if (typeof p === "string" && p === f) {
        const e: NodeJS.ErrnoException = new Error("EACCES: injected");
        e.code = "EACCES";
        throw e;
      }
      return (orig as unknown as (p: fs.PathLike, o?: unknown) => unknown)(
        p,
        options,
      );
    }) as typeof fs.statSync);
    try {
      const r = parseManifest(f);
      expect(r.kind).toBe("unreadable");
      if (r.kind === "unreadable") {
        expect(r.error).toContain("EACCES");
      }
    } finally {
      spy.mockRestore();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns {kind:'missing'} (not 'unreadable') when statSync throws ENOENT", () => {
    // ENOENT is the legitimate "file absent" signal and must continue to
    // route to {kind:"missing"}. Only non-ENOENT errno values escalate
    // to "unreadable".
    const r = parseManifest(
      path.join(os.tmpdir(), "definitely-absent-xyz", "manifest.yaml"),
    );
    expect(r.kind).toBe("missing");
  });

  it("returns {kind:'malformed'} when dirSlug is the empty string (caller bug)", () => {
    // Regression for FX30-C Fix 3 (R29-2 H2): `""` is NOT a valid opt-out
    // sentinel — `undefined` means "caller opted out of slug-check".
    // An empty string usually comes from path.basename on a weird path
    // (trailing slash, etc.) in the caller; silently collapsing it to
    // undefined hides a caller bug. The parser must surface it.
    const tmp = fs.mkdtempSync(
      path.join(os.tmpdir(), "lib-manifest-empty-slug-"),
    );
    const f = path.join(tmp, "manifest.yaml");
    fs.writeFileSync(f, "slug: mypkg\n");
    try {
      const r = parseManifest(f, "");
      expect(r.kind).toBe("malformed");
      if (r.kind === "malformed") {
        expect(r.subkind).toBe("shape");
        expect(r.error).toMatch(/empty.*dirSlug|dirSlug.*empty/i);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns {kind:'unreadable'} when readFileSync throws (e.g. EACCES)", () => {
    // Simulate a permission error via spy. existsSync returns true but
    // readFileSync throws — the parser must surface this as 'unreadable',
    // distinct from 'missing' (file absent) and 'malformed' (file present,
    // contents bad).
    //
    // The spy falls through to the original implementation for any path
    // other than the target manifest. Throwing "unexpected readFileSync
    // call" from within a spy masked the real failure (e.g. vitest's own
    // readFileSync for transform cache) with a confusing error — fall-
    // through is the correct behavior for a mock of this shape.
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: ok\n");
    const orig = fs.readFileSync;
    const spy = vi.spyOn(fs, "readFileSync").mockImplementation(((
      p: fs.PathOrFileDescriptor,
      options?: unknown,
    ) => {
      if (typeof p === "string" && p === f) {
        const e: NodeJS.ErrnoException = new Error("EACCES: permission denied");
        e.code = "EACCES";
        throw e;
      }
      return (
        orig as unknown as (p: fs.PathOrFileDescriptor, o?: unknown) => unknown
      )(p, options);
    }) as typeof fs.readFileSync);
    try {
      const r = parseManifest(f);
      expect(r.kind).toBe("unreadable");
      if (r.kind === "unreadable") {
        expect(r.error).toContain("EACCES");
      }
    } finally {
      spy.mockRestore();
    }
  });
});

describe("AGENT_KINDS", () => {
  it("matches the agent_kind enum in manifest.schema.json", () => {
    // The list existed as THREE independent copies, each documented as "the"
    // runtime-checkable one. This pins two of them together (JSON cannot import
    // TypeScript, so the schema copy cannot be deleted), and generate-registry.ts
    // enforces the same equality on every build. The third copy —
    // showcase/frontends/nextjs/src/lib/agent-resolution.ts — still cannot
    // import this package, but it no longer goes unchecked until request time:
    // agent-resolution.test.ts ("AGENT_KINDS") reads the same schema file off
    // disk and asserts the same set equality. All three are pinned to the
    // schema, so the schema is the one place to edit the list.
    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf-8")) as {
      properties: { agent_kind: { enum: string[] } };
    };
    expect([...schema.properties.agent_kind.enum].sort()).toEqual(
      [...AGENT_KINDS].sort(),
    );
  });
});

describe("createDemoId", () => {
  it("accepts a non-empty string and returns a branded DemoId", () => {
    const id = createDemoId("foo");
    expect(id).toBe("foo");
  });

  it("returns null for the empty string", () => {
    expect(createDemoId("")).toBeNull();
  });

  it("accepts unknown input and returns null for non-string values", () => {
    // Signature widened from (s: string) to (s: unknown) so the dead
    // typeof check becomes a live guard. Non-string inputs at API
    // boundaries (yaml.parse results, untyped JSON) return null rather
    // than silently producing a fake branded id.
    expect(createDemoId(null)).toBeNull();
    expect(createDemoId(undefined)).toBeNull();
    expect(createDemoId(42)).toBeNull();
    expect(createDemoId({})).toBeNull();
    expect(createDemoId([])).toBeNull();
    expect(createDemoId(true)).toBeNull();
  });

  it("narrows its input via a type predicate (compile-time shape)", () => {
    // The returned value, when non-null, is both a DemoId AND carries a
    // TypeScript narrowing that lets callers read it as a string without
    // further casts. This test is mostly structural — the assertion is
    // that the code compiles; we still run a basic runtime check.
    const candidate: unknown = "abc";
    const id = createDemoId(candidate);
    if (id !== null) {
      // Compiler should accept DemoId as assignable to a string-slot.
      const asString: string = id;
      expect(asString).toBe("abc");
      // Also exercise the DemoId type import to ensure the export exists.
      const branded: DemoId = id;
      expect(branded).toBe("abc");
    }
  });
});
