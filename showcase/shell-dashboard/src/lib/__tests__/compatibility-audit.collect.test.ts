// @vitest-environment node
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectAudit } from "../../../scripts/compatibility-audit/collect";
import type { RawResponse } from "../../../scripts/compatibility-audit/types";

const SHA = "a".repeat(40);
const AS_OF = "2026-09-30T15:00:00Z";
const OBSERVED_AT = "2026-10-01T12:00:00.000Z";
const ORIGINAL_SNAPSHOT = "original snapshot must remain unchanged\n";
const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

// The CLI test owns the complete mapping/all-registry success fixture. These
// small inputs stop at the second PyPI inventory, before assessment or writes.
async function fixture(failure: "interrupted" | "incomplete") {
  const root = await mkdtemp(join(tmpdir(), "compatibility-collect-"));
  directories.push(root);
  const snapshotPath = join(root, "compatibility-snapshot.ts");
  await writeFile(snapshotPath, ORIGINAL_SNAPSHOT);
  const responses = new Map<string, unknown>();
  for (const name of ["ag2", "agno"]) {
    responses.set(`https://pypi.org/simple/${name}/`, {
      name,
      meta: { "api-version": "1.1" },
      versions: ["1.0.0"],
      files: [
        {
          filename: `${name}-1.0.0.tar.gz`,
          ...(name === "ag2" ? { "upload-time": "2026-09-01T00:00:00Z" } : {}),
        },
      ],
    });
  }
  responses.set("https://pypi.org/pypi/agno/1.0.0/json", {
    info: { version: "1.0.0" },
    urls: [{ filename: "agno-1.0.0.tar.gz", yanked: false }],
  });
  const get = vi.fn(async (url: string): Promise<RawResponse> => {
    if (failure === "interrupted" && url === "https://pypi.org/simple/agno/")
      throw new Error("SYNTHETIC_REGISTRY_SECRET");
    if (!responses.has(url)) throw new Error("Unexpected fixture URL");
    return {
      url,
      status: 200,
      observedAt: OBSERVED_AT,
      body: JSON.stringify(responses.get(url)),
    };
  });
  return { root, snapshotPath, get };
}

describe("collectAudit failure boundaries", () => {
  it.each(["interrupted", "incomplete"] as const)(
    "leaves the snapshot unchanged on %s registry capture",
    async (failure) => {
      const f = await fixture(failure);
      const out = join(f.root, "audit.json");
      await expect(
        collectAudit(
          {
            asOf: AS_OF,
            out,
            writeSnapshot: true,
          },
          {
            repo: f.root,
            snapshotPath: f.snapshotPath,
            resolveOriginMain: () => SHA,
            captureSourceFiles: () => [
              {
                path: "showcase/integrations/ag2/requirements.txt",
                body: "ag2==1.0.0\n",
              },
            ],
            httpClient: { get: f.get },
          },
        ),
      ).rejects.toThrow(
        failure === "incomplete"
          ? "Registry inventory is incomplete for pypi/agno"
          : "Registry collection failed for pypi/agno",
      );
      expect(f.get.mock.calls.map(([url]) => url)).toEqual([
        "https://pypi.org/simple/ag2/",
        "https://pypi.org/simple/agno/",
        ...(failure === "incomplete"
          ? ["https://pypi.org/pypi/agno/1.0.0/json"]
          : []),
      ]);
      expect(await readFile(f.snapshotPath, "utf8")).toBe(ORIGINAL_SNAPSHOT);
      expect(await readdir(f.root)).toEqual(["compatibility-snapshot.ts"]);
    },
  );
});
