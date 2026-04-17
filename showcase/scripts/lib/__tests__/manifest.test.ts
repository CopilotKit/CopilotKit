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
import { parseManifest } from "../manifest.js";

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

  it("returns {kind:'ok'} when demos is omitted entirely", () => {
    // `demos` is optional. A manifest without it should parse cleanly.
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: mypkg\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.manifest.demos).toBeUndefined();
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
