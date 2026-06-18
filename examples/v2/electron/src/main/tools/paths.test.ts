import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolve, join } from "node:path";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
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

describe("resolveInWorkspace — REJECT symlink escapes (real fs)", () => {
  let parent: string;
  let wsRoot: string;
  let secretFile: string;

  beforeAll(() => {
    parent = mkdtempSync(join(tmpdir(), "paths-symlink-"));
    wsRoot = join(parent, "workspace");
    const secretDir = join(parent, "secret");
    secretFile = join(secretDir, "passwd.txt");
    mkdirSync(wsRoot);
    mkdirSync(secretDir);
    writeFileSync(secretFile, "TOP SECRET");

    symlinkSync(join("..", "secret", "passwd.txt"), join(wsRoot, "leak.txt"));
    symlinkSync(join("..", "secret"), join(wsRoot, "escape"));
    symlinkSync(secretFile, join(wsRoot, "abs-leak.txt"));
  });

  afterAll(() => {
    rmSync(parent, { recursive: true, force: true });
  });

  it("rejects an in-root file symlink to an out-of-root file", () => {
    expect(() => resolveInWorkspace(wsRoot, "leak.txt")).toThrow(
      /outside the workspace root/,
    );
  });

  it("rejects writing through an in-root dir symlink to an out-of-root dir", () => {
    expect(() => resolveInWorkspace(wsRoot, "escape/x.txt")).toThrow(
      /outside the workspace root/,
    );
  });

  it("rejects an in-root symlink to an absolute out-of-root path", () => {
    expect(() => resolveInWorkspace(wsRoot, "abs-leak.txt")).toThrow(
      /outside the workspace root/,
    );
  });
});
