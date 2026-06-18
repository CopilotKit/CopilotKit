import { describe, it, expect } from "vitest";
import { resolve, join } from "node:path";
import { resolveInWorkspace } from "./paths";

const ROOT = "/tmp/ws";

describe("resolveInWorkspace — ACCEPT", () => {
  it("accepts a simple relative filename", () => {
    const result = resolveInWorkspace(ROOT, "a.txt");
    expect(result).toBe(join(ROOT, "a.txt"));
  });

  it("accepts a nested relative path", () => {
    const result = resolveInWorkspace(ROOT, "sub/b.md");
    expect(result).toBe(join(ROOT, "sub/b.md"));
  });

  it("accepts a ./ prefixed relative path", () => {
    const result = resolveInWorkspace(ROOT, "./x");
    expect(result).toBe(join(ROOT, "x"));
  });

  it("accepts an absolute path that is inside the root", () => {
    const inside = join(ROOT, "nested/file.ts");
    const result = resolveInWorkspace(ROOT, inside);
    expect(result).toBe(inside);
  });
});

describe("resolveInWorkspace — REJECT (outside the workspace root)", () => {
  it('rejects ".."', () => {
    expect(() => resolveInWorkspace(ROOT, "..")).toThrow(
      /outside the workspace root/,
    );
  });

  it('rejects deep "../../etc"', () => {
    expect(() => resolveInWorkspace(ROOT, "../../etc")).toThrow(
      /outside the workspace root/,
    );
  });

  it('rejects absolute path outside root ("/etc/passwd")', () => {
    expect(() => resolveInWorkspace(ROOT, "/etc/passwd")).toThrow(
      /outside the workspace root/,
    );
  });

  it("rejects sibling-prefix path (/tmp/ws-evil/x when root is /tmp/ws)", () => {
    expect(() => resolveInWorkspace(ROOT, "/tmp/ws-evil/x")).toThrow(
      /outside the workspace root/,
    );
  });

  it('rejects a path that escapes via "sub/../../.."', () => {
    expect(() => resolveInWorkspace(ROOT, "sub/../../..")).toThrow(
      /outside the workspace root/,
    );
  });
});
