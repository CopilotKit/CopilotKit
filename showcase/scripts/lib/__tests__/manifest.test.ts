/**
 * Tests for showcase/scripts/lib/manifest.ts.
 *
 * parseManifest is the single source of truth for reading and shape-validating
 * manifest.yaml. Tests pin the tagged-union return shape that the three
 * validators (audit.ts / validate-parity.ts / validate-pins.ts) rely on.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { parseManifest, createDemoId, type DemoId } from "../manifest.js";

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
    // validate-pins.ts) relies on it. Missing slug = unconditional bug.
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
    // demo-path construction (`packages/<slug>/src/app/demos/<id>`) collapse
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
      const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "lib-manifest-parent-eacces-"),
      );
      const parentDir = path.join(root, "locked");
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
        fs.rmSync(root, { recursive: true, force: true });
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
