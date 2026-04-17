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

  it("returns {kind:'malformed'} for an empty file (yaml.parse → null)", () => {
    // Empty YAML parses to null, which is not a valid manifest mapping. The
    // guard must reject it before callers try to read .demos / .deployed.
    const f = path.join(root, "manifest.yaml");
    write(f, "");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.error.length).toBeGreaterThan(0);
    }
  });

  it("returns {kind:'malformed'} for a non-object YAML (bare scalar)", () => {
    const f = path.join(root, "manifest.yaml");
    write(f, "42\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
  });

  it("returns {kind:'malformed'} for an array at top level", () => {
    const f = path.join(root, "manifest.yaml");
    write(f, "- a\n- b\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
  });

  it("returns {kind:'malformed'} for a syntactically broken YAML", () => {
    const f = path.join(root, "manifest.yaml");
    write(f, "demos: [[[\nunterminated\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
  });

  it("returns {kind:'malformed'} when demos is not an array", () => {
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: x\ndemos: not-array\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.error).toMatch(/demos/i);
    }
  });

  it("returns {kind:'malformed'} when a demo entry lacks a string id", () => {
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: x\ndemos:\n  - noid: true\n");
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.error).toMatch(/id/i);
    }
  });

  it("returns {kind:'malformed'} when deployed is present but not a boolean", () => {
    const f = path.join(root, "manifest.yaml");
    write(f, 'slug: x\ndeployed: "yes"\n');
    const r = parseManifest(f);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
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
    const f = path.join(root, "manifest.yaml");
    write(f, "slug: ok\n");
    const spy = vi.spyOn(fs, "readFileSync").mockImplementation(((
      p: fs.PathOrFileDescriptor,
    ) => {
      if (typeof p === "string" && p === f) {
        const e: NodeJS.ErrnoException = new Error("EACCES: permission denied");
        e.code = "EACCES";
        throw e;
      }
      throw new Error("unexpected readFileSync call");
    }) as unknown as typeof fs.readFileSync);
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
