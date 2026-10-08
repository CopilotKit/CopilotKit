import type {
  CompatibilitySnapshotPackage,
  CompatibilitySnapshotRow,
  CompatibilitySnapshotStatus,
} from "../../src/data/compatibility-snapshot";
import {
  aggregateCompatibilityScores,
  scoreCompatibilityVersion,
} from "../../src/lib/compatibility-score";
import { selectRelease } from "./releases";
import type { ReleaseSelection } from "./releases";
import { resolveSourceFact } from "./source";
import type {
  CompatibilitySnapshotValue,
  Inventory,
  LibraryMapping,
  Registry,
  Release,
  SavedFileReader,
  VariantMapping,
  VersionFact,
} from "./types";

export interface AssessmentInput {
  sourceSha: string;
  asOf: string;
  mapping: VariantMapping[];
  read: SavedFileReader;
  inventories: Inventory[];
}

export interface PackageAssessment {
  slug: string;
  name: string;
  registry: Registry;
  role: LibraryMapping["role"];
  required: boolean;
  mappingReason: string;
  sourcePath: string;
  lockPath: string | null;
  sourceFact: VersionFact;
  releasePolicy: LibraryMapping["releasePolicy"];
  sourceUrl: string;
  selection: ReleaseSelection;
  selectedRelease: Pick<
    Release,
    "version" | "timestamp" | "timestampKind"
  > | null;
  compatibilityScore: number | null;
  scoreReason:
    | "scored"
    | "running-version-unknown"
    | "release-selection-unavailable"
    | "version-comparison-unscorable";
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const METHODOLOGY =
  "https://app.notion.com/p/copilotkit/scorecard-3c23aa381852803dae5cf99a2e76979f";

function inventoryKey(registry: Registry, name: string): string {
  const canonicalName =
    registry === "pypi"
      ? name.toLowerCase().replace(/[-_.]+/g, "-")
      : registry === "nuget"
        ? name.toLowerCase()
        : name;
  return `${registry}:${canonicalName}`;
}

function scoreReason(
  fact: VersionFact,
  selection: ReleaseSelection,
  score: number | null,
): PackageAssessment["scoreReason"] {
  if (fact.version === null) return "running-version-unknown";
  if (selection.unavailableReason !== null)
    return "release-selection-unavailable";
  return score === null ? "version-comparison-unscorable" : "scored";
}

function rowStatus(
  packages: PackageAssessment[],
  score: number | null,
): CompatibilitySnapshotStatus {
  if (packages.some((pkg) => pkg.sourceFact.version === null))
    return "not_verified";
  if (score === null) return "policy_pending_or_incomplete_package_score";
  return "source_declared_prototype_scored";
}

/** Assess pinned source facts without collecting, writing or consulting the clock. */
export function assessCompatibility(input: AssessmentInput): {
  snapshot: CompatibilitySnapshotValue;
  packages: PackageAssessment[];
} {
  const byInventory = new Map<string, Inventory>();
  for (const inventory of input.inventories) {
    const key = inventoryKey(inventory.registry, inventory.name);
    if (byInventory.has(key))
      throw new Error(`Duplicate release inventory for ${key}`);
    byInventory.set(key, inventory);
  }
  const rows: CompatibilitySnapshotRow[] = [];
  const packages: PackageAssessment[] = [];

  for (const variant of input.mapping) {
    if (variant.excludedReason !== undefined) continue;
    const required = variant.libraries.filter((library) => library.required);
    if (required.length === 0) continue;

    const rowEvidence: PackageAssessment[] = [];
    const rowPackages: CompatibilitySnapshotPackage[] = [];
    for (const library of required) {
      const key = inventoryKey(library.registry, library.name);
      const inventory = byInventory.get(key);
      if (!inventory) throw new Error(`Missing release inventory for ${key}`);
      const sourceFact = resolveSourceFact(library, input.read);
      const selection = selectRelease(
        inventory,
        library.releasePolicy,
        input.asOf,
      );
      const selected = inventory.releases.find(
        (release) => release.version === selection.latest,
      );
      const selectedRelease = selected
        ? {
            version: selected.version,
            timestamp: selected.timestamp,
            timestampKind: selected.timestampKind,
          }
        : null;
      const compatibilityScore = scoreCompatibilityVersion({
        runningVersion: sourceFact.version,
        latest: selection.latest,
        previewTrains: selection.previewTrains,
      });
      rowEvidence.push({
        slug: variant.slug,
        name: library.name,
        registry: library.registry,
        role: library.role,
        required: library.required,
        mappingReason: library.reason,
        sourcePath: library.source.path,
        lockPath: library.source.lockPath ?? null,
        sourceFact,
        releasePolicy: library.releasePolicy,
        sourceUrl: inventory.sourceUrl,
        selection,
        selectedRelease,
        compatibilityScore,
        scoreReason: scoreReason(sourceFact, selection, compatibilityScore),
      });
      rowPackages.push({
        name: library.name,
        role: library.role,
        drivesCompatibility: true,
        compatibilityScore,
        setsVariantScore: false,
        runningVersion: sourceFact.version,
        latest: selection.latest,
        sourceUrl: inventory.sourceUrl,
      });
    }

    const currentScore = aggregateCompatibilityScores(
      rowEvidence.map((pkg) => pkg.compatibilityScore),
    );
    for (const pkg of rowPackages) {
      pkg.setsVariantScore =
        currentScore !== null && pkg.compatibilityScore === currentScore;
    }
    rows.push({
      slug: variant.slug,
      language: variant.language,
      currentScore,
      status: rowStatus(rowEvidence, currentScore),
      packages: rowPackages,
    });
    packages.push(...rowEvidence);
  }

  const assessedAt = new Date(input.asOf);
  return {
    snapshot: {
      date: `${MONTHS[assessedAt.getUTCMonth()]} ${assessedAt.getUTCDate()}, ${assessedAt.getUTCFullYear()}`,
      assessedAt: input.asOf,
      methodology: METHODOLOGY,
      rows,
    },
    packages,
  };
}
