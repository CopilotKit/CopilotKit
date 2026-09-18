/** Explicit offline rescore: tsx scripts/rescore-compatibility.ts --audit-dir /absolute/audit [--check] */
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { COMPATIBILITY_SNAPSHOT } from "../src/data/compatibility-snapshot";
import type {
  CompatibilitySnapshotPackage,
  CompatibilitySnapshotRow,
  CompatibilitySnapshotStatus,
} from "../src/data/compatibility-snapshot";
import {
  aggregateCompatibilityScores,
  scoreCompatibilityVersion,
} from "../src/lib/compatibility-score";

interface Assessment {
  as_of: string;
  package_rows: {
    slug: string;
    package_name: string;
    release_policy?: { rule?: string; as_of?: string };
  }[];
}

interface Collection {
  asOf: string;
  nuget: {
    id: string;
    versions?: { version?: string; listed?: boolean; published?: string }[];
  }[];
}

function timestamp(value: unknown, label: string): number {
  const time = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(time)) throw new Error(`Missing or invalid ${label}.`);
  return time;
}

function previewTrains(
  collection: Collection,
  name: string,
  assessedAt: number,
): string[] {
  const entries = collection.nuget.filter(
    (entry) => entry.id?.toLowerCase() === name.toLowerCase(),
  );
  if (entries.length !== 1 || !Array.isArray(entries[0].versions)) {
    throw new Error(`Expected one saved NuGet version inventory for ${name}.`);
  }

  const trains = new Set<string>();
  for (const release of entries[0].versions) {
    const published =
      typeof release.published === "string"
        ? Date.parse(release.published)
        : NaN;
    if (
      release.listed === false ||
      !Number.isFinite(published) ||
      published > assessedAt ||
      typeof release.version !== "string"
    ) {
      continue;
    }

    const match =
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-preview\.(\d{6})\.(0|[1-9]\d*)$/.exec(
        release.version,
      );
    if (
      match &&
      match[0] === release.version &&
      [match[1], match[2], match[3], match[5]].every((part) =>
        Number.isSafeInteger(Number(part)),
      )
    ) {
      trains.add(`${match[1]}.preview.${match[4]}`);
    }
  }
  // The scorer validates, de-duplicates and numerically orders the full train IDs.
  return [...trains];
}

function main(): void {
  const { values } = parseArgs({
    options: {
      "audit-dir": { type: "string" },
      check: { type: "boolean", default: false },
    },
  });
  const auditDir = values["audit-dir"];
  if (!auditDir || !isAbsolute(auditDir)) {
    throw new Error("Provide --audit-dir with an absolute saved audit path.");
  }

  const assessment: Assessment = JSON.parse(
    readFileSync(join(auditDir, "assessment.json"), "utf8"),
  );
  const collection: Collection = JSON.parse(
    readFileSync(join(auditDir, "nuget-maven/collection.json"), "utf8"),
  );
  const assessedAt = timestamp(
    COMPATIBILITY_SNAPSHOT.assessedAt,
    "snapshot assessedAt",
  );
  if (
    timestamp(assessment.as_of, "assessment.as_of") !== assessedAt ||
    timestamp(collection.asOf, "collection.asOf") !== assessedAt
  ) {
    throw new Error("Snapshot and saved audit as-of dates must match.");
  }
  if (
    !Array.isArray(assessment.package_rows) ||
    !Array.isArray(collection.nuget)
  ) {
    throw new Error(
      "Saved audit must contain package_rows and NuGet inventories.",
    );
  }

  const rows: CompatibilitySnapshotRow[] = COMPATIBILITY_SNAPSHOT.rows.map(
    (row) => {
      const packages: CompatibilitySnapshotPackage[] = row.packages.map(
        (pkg) => {
          // Old snapshots may still carry this retired derived field.
          const { graceTarget: _graceTarget, ...facts } =
            pkg as CompatibilitySnapshotPackage & {
              graceTarget?: string | null;
            };
          if (!pkg.drivesCompatibility) {
            return {
              ...facts,
              compatibilityScore: null,
              setsVariantScore: false,
            };
          }

          const matches = assessment.package_rows.filter(
            (entry) =>
              entry.slug === row.slug && entry.package_name === pkg.name,
          );
          const policy = matches[0]?.release_policy;
          if (
            matches.length !== 1 ||
            typeof policy?.rule !== "string" ||
            !policy.rule
          ) {
            throw new Error(
              `Expected one saved release policy for ${row.slug}/${pkg.name}.`,
            );
          }
          if (
            timestamp(
              policy.as_of,
              `${row.slug}/${pkg.name} release_policy.as_of`,
            ) !== assessedAt
          ) {
            throw new Error(
              `Release policy as-of date differs for ${row.slug}/${pkg.name}.`,
            );
          }

          const trains = policy.rule.startsWith("preview train")
            ? previewTrains(collection, pkg.name, assessedAt)
            : undefined;
          return {
            ...facts,
            compatibilityScore: scoreCompatibilityVersion({
              runningVersion: pkg.runningVersion,
              latest: pkg.latest,
              previewTrains: trains,
            }),
            setsVariantScore: false,
          };
        },
      );

      const currentScore =
        row.status === "internal_non_comparable"
          ? null
          : aggregateCompatibilityScores(
              packages
                .filter((pkg) => pkg.drivesCompatibility)
                .map((pkg) => pkg.compatibilityScore),
            );
      for (const pkg of packages) {
        pkg.setsVariantScore =
          pkg.drivesCompatibility &&
          currentScore !== null &&
          Number.isFinite(currentScore) &&
          pkg.compatibilityScore === currentScore;
      }
      let status: CompatibilitySnapshotStatus = row.status;
      if (
        currentScore === null &&
        status !== "internal_non_comparable" &&
        (row.currentScore !== null || status.endsWith("_scored"))
      ) {
        status = "policy_pending_or_incomplete_package_score";
      }
      return { ...row, currentScore, status, packages };
    },
  );
  const snapshot = { ...COMPATIBILITY_SNAPSHOT, rows };

  if (values.check) {
    if (!isDeepStrictEqual(COMPATIBILITY_SNAPSHOT, snapshot)) {
      throw new Error(
        "Compatibility snapshot is stale; rerun without --check to rescore it.",
      );
    }
    console.log("Compatibility snapshot matches the saved audit facts.");
    return;
  }

  const snapshotPath = new URL(
    "../src/data/compatibility-snapshot.ts",
    import.meta.url,
  );
  const source = readFileSync(snapshotPath, "utf8");
  const declaration = /export const COMPATIBILITY_SNAPSHOT\s*=\s*/.exec(source);
  const wrapperStart = source.lastIndexOf(" satisfies ");
  if (
    !declaration ||
    wrapperStart <= declaration.index + declaration[0].length
  ) {
    throw new Error(
      "Cannot find the static snapshot declaration and satisfies wrapper.",
    );
  }
  const prefix = source.slice(0, declaration.index + declaration[0].length);
  const suffix = source.slice(wrapperStart);
  writeFileSync(
    snapshotPath,
    `${prefix}${JSON.stringify(snapshot, null, 2)}${suffix}`,
  );
  console.log(
    `Rescored ${rows.length} static compatibility variants from saved audit facts.`,
  );
}

try {
  main();
} catch (error) {
  console.error(
    `Cannot rescore compatibility: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
