// @vitest-environment node
import {
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import type * as fsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeSnapshotAtomic } from "../../../scripts/compatibility-audit/snapshot-file";
import type { CompatibilitySnapshotValue } from "../../../scripts/compatibility-audit/types";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof fsPromises>();
  return { ...actual, open: vi.fn(actual.open), rename: vi.fn(actual.rename) };
});

const header = `// Retain this declaration header verbatim.\nexport interface CompatibilitySnapshotRow { slug: string }\n\nexport const COMPATIBILITY_SNAPSHOT = `;
const wrapper = ` satisfies {\n  date: string;\n  assessedAt: string;\n  methodology: string;\n  rows: CompatibilitySnapshotRow[];\n};\n`;

function value(): CompatibilitySnapshotValue {
  return {
    date: "September 30, 2026",
    assessedAt: "2026-09-30T12:00:00Z",
    methodology: "https://example.test/methodology",
    rows: [
      {
        slug: "fixture",
        language: "typescript",
        currentScore: 95,
        status: "source_declared_prototype_scored",
        packages: [
          {
            name: "fixture-lib",
            role: "framework",
            drivesCompatibility: true,
            compatibilityScore: 95,
            setsVariantScore: true,
            runningVersion: "1.0.0",
            latest: "1.0.2",
            sourceUrl: "https://example.test/fixture-lib",
          },
        ],
      },
    ],
  };
}

const original = `${header}{
  date: "old",
  assessedAt: "2026-09-17T00:00:00Z",
  methodology: "an escaped \\"} satisfies {\\" marker",
  rows: [ /* braces in comments: } ] */ ],
}${wrapper}`;

describe("explicit atomic compatibility snapshot replacement", () => {
  let directory: string;
  let path: string;

  beforeEach(async () => {
    const actual = await vi.importActual<typeof fsPromises>("node:fs/promises");
    vi.mocked(open).mockReset().mockImplementation(actual.open);
    vi.mocked(rename).mockReset().mockImplementation(actual.rename);
    directory = await mkdtemp(join(tmpdir(), "compatibility-snapshot-test-"));
    path = join(directory, "snapshot.ts");
    await writeFile(path, original);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it("replaces only the value through a temporary file beside the target", async () => {
    const snapshot = value();
    await writeSnapshotAtomic(path, snapshot);

    expect(await readFile(path, "utf8")).toBe(
      `${header}${JSON.stringify(snapshot, null, 2)}${wrapper}`,
    );
    expect(rename).toHaveBeenCalledTimes(1);
    const [temporary, target] = vi.mocked(rename).mock.calls[0];
    expect(dirname(String(temporary))).toBe(directory);
    expect(String(temporary)).not.toBe(path);
    expect(target).toBe(path);
    expect(await readdir(directory)).toEqual([basename(path)]);
  });

  it("retains null scores and unknown versions", async () => {
    const snapshot = value();
    snapshot.rows[0].currentScore = null;
    snapshot.rows[0].status = "not_verified";
    Object.assign(snapshot.rows[0].packages[0], {
      compatibilityScore: null,
      setsVariantScore: false,
      runningVersion: null,
      latest: null,
      sourceUrl: null,
    });
    await writeSnapshotAtomic(path, snapshot);
    expect(await readFile(path, "utf8")).toBe(
      `${header}${JSON.stringify(snapshot, null, 2)}${wrapper}`,
    );
  });

  it.each([
    ["missing wrapper", `${header}{}`],
    [
      "wrong wrapper type",
      original.replace("rows: CompatibilitySnapshotRow[];", "rows: string[];"),
    ],
    ["unterminated wrapper", original.slice(0, -3)],
    ["unbalanced value", `${header}{ rows: [ }${wrapper}`],
    ["unterminated string", `${header}{ date: "unfinished }${wrapper}`],
    ["duplicate declaration", `${original}${original}`],
    ["trailing executable code", `${original}doSomething();\n`],
  ])("rejects %s without changing the file", async (_label, source) => {
    await writeFile(path, source);
    await expect(writeSnapshotAtomic(path, value())).rejects.toThrow(
      /snapshot/i,
    );
    expect(await readFile(path, "utf8")).toBe(source);
    expect(open).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([basename(path)]);
  });

  it("cleans up a failed temporary write before rename and leaves the original intact", async () => {
    const actual = await vi.importActual<typeof fsPromises>("node:fs/promises");
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await actual.open(...args);
      vi.spyOn(handle, "writeFile").mockRejectedValueOnce(
        new Error("fixture write failure"),
      );
      return handle;
    });
    await expect(writeSnapshotAtomic(path, value())).rejects.toThrow(
      "fixture write failure",
    );
    expect(rename).not.toHaveBeenCalled();
    expect(await readFile(path, "utf8")).toBe(original);
    expect(await readdir(directory)).toEqual([basename(path)]);
  });

  it("cleans up a failed rename and leaves the original intact", async () => {
    vi.mocked(rename).mockRejectedValueOnce(
      new Error("fixture rename failure"),
    );
    await expect(writeSnapshotAtomic(path, value())).rejects.toThrow(
      "fixture rename failure",
    );
    expect(await readFile(path, "utf8")).toBe(original);
    expect(await readdir(directory)).toEqual([basename(path)]);
  });
});
