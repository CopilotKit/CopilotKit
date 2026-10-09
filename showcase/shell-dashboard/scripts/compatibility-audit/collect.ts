import { lstat, writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createLiveHttpClient } from "./http";
import { COMPATIBILITY_MAPPING } from "./mapping";
import { collectMaven } from "./registries/maven";
import { collectNpm } from "./registries/npm";
import { collectNuget } from "./registries/nuget";
import { collectPypi } from "./registries/pypi";
import { assessCompatibility } from "./snapshot";
import type { PackageAssessment } from "./snapshot";
import { writeSnapshotAtomic } from "./snapshot-file";
import { captureSourceFiles, resolveOriginMain } from "./source";
import type {
  CollectOptions,
  CompatibilitySnapshotValue,
  HttpClient,
  Inventory,
  LibraryMapping,
  RawResponse,
} from "./types";

export interface CollectAdapters {
  repo?: string;
  resolveOriginMain?: typeof resolveOriginMain;
  captureSourceFiles?: typeof captureSourceFiles;
  httpClient?: HttpClient;
  clock?: () => Date;
  snapshotPath?: string;
}

export interface AuditReport {
  schemaVersion: 1;
  source: { sha: string; label: "prototype-source" };
  asOf: string;
  observations: Pick<RawResponse, "url" | "status" | "observedAt">[];
  packages: PackageAssessment[];
  exclusions: {
    slug: string;
    excludedReason: string | null;
    libraries: { name: string; reason: string }[];
  }[];
  snapshot: CompatibilitySnapshotValue;
}

export interface AuditResult {
  report: AuditReport;
  snapshot: CompatibilitySnapshotValue;
  packages: PackageAssessment[];
}

const COLLECTORS = {
  npm: collectNpm,
  pypi: collectPypi,
  nuget: collectNuget,
  maven: collectMaven,
};

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function inventoryKey(library: LibraryMapping): string {
  const name =
    library.registry === "pypi"
      ? library.name.toLowerCase().replace(/[-_.]+/g, "-")
      : library.registry === "nuget"
        ? library.name.toLowerCase()
        : library.name;
  return `${library.registry}:${name}`;
}

/** Collect a complete source assessment before writing either output. */
export async function collectAudit(
  options: CollectOptions,
  injectedAdapters: CollectAdapters = {},
): Promise<AuditResult> {
  const repo =
    injectedAdapters.repo ??
    fileURLToPath(new URL("../../../../", import.meta.url));
  const snapshotPath =
    injectedAdapters.snapshotPath ??
    fileURLToPath(
      new URL("../../src/data/compatibility-snapshot.ts", import.meta.url),
    );
  if (
    !isAbsolute(repo) ||
    !isAbsolute(snapshotPath) ||
    !isAbsolute(options.out)
  )
    throw new Error(
      "Repository, snapshot and audit output paths must be absolute.",
    );
  // An explicit report path is exclusive. Reject it before any collection work.
  try {
    await lstat(options.out);
    throw new Error("Audit output file already exists.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const sourceSha = (injectedAdapters.resolveOriginMain ?? resolveOriginMain)(
    repo,
  );
  const sourceFiles = (
    injectedAdapters.captureSourceFiles ?? captureSourceFiles
  )(repo, sourceSha, COMPATIBILITY_MAPPING);
  const savedSources = new Map(
    sourceFiles.map((file) => [file.path, file.body]),
  );
  const clock = injectedAdapters.clock ?? (() => new Date());
  const transport =
    injectedAdapters.httpClient ?? createLiveHttpClient({ clock });
  const observations = new Map<
    string,
    Pick<RawResponse, "url" | "status" | "observedAt">
  >();
  // Shared registry endpoints, including NuGet's service index, are fetched once.
  // Response bodies remain transient and are discarded after inventory parsing.
  const requests = new Map<string, Promise<RawResponse>>();
  const client: HttpClient = {
    async get(url, accept) {
      let request = requests.get(url);
      if (!request) {
        request = (async () => {
          const response = await transport.get(url, accept);
          if (
            response.url !== url ||
            !Number.isInteger(response.status) ||
            response.status < 200 ||
            response.status >= 300
          )
            throw new Error("Invalid registry response");
          observations.set(url, {
            url: response.url,
            status: response.status,
            observedAt: response.observedAt,
          });
          return response;
        })();
        requests.set(url, request);
      }
      return { ...(await request) };
    },
  };

  const inventories: Inventory[] = [];
  const collected = new Set<string>();
  for (const variant of COMPATIBILITY_MAPPING) {
    if (variant.excludedReason !== undefined) continue;
    for (const library of variant.libraries) {
      const key = inventoryKey(library);
      if (!library.required || collected.has(key)) continue;
      let inventory: Inventory;
      try {
        inventory = await COLLECTORS[library.registry](library.name, client);
      } catch {
        throw new Error(
          `Registry collection failed for ${library.registry}/${library.name}`,
        );
      }
      if (!inventory.complete)
        throw new Error(
          `Registry inventory is incomplete for ${library.registry}/${library.name}`,
        );
      inventories.push(inventory);
      collected.add(key);
    }
  }
  requests.clear();

  const result = assessCompatibility({
    sourceSha,
    asOf: options.asOf,
    mapping: COMPATIBILITY_MAPPING,
    inventories,
    read(path) {
      const body = savedSources.get(path);
      if (body === undefined)
        throw new Error(`Missing captured source file: ${path}`);
      return body;
    },
  });
  const report: AuditReport = {
    schemaVersion: 1,
    source: { sha: sourceSha, label: "prototype-source" },
    asOf: options.asOf,
    observations: [...observations.values()].sort((a, b) =>
      compare(a.url, b.url),
    ),
    packages: result.packages,
    exclusions: COMPATIBILITY_MAPPING.filter(
      (variant) => variant.excludedReason || variant.excludedLibraries.length,
    ).map((variant) => ({
      slug: variant.slug,
      excludedReason: variant.excludedReason ?? null,
      libraries: variant.excludedLibraries,
    })),
    snapshot: result.snapshot,
  };
  await writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  if (options.writeSnapshot === true)
    await writeSnapshotAtomic(snapshotPath, result.snapshot);
  return { report, ...result };
}
