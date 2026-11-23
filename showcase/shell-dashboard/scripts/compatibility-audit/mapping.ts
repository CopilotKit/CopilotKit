import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// One library roster is shared by the collector and publication validator.
export {
  COMPATIBILITY_MAPPING,
  assertMappingCoverage,
  assessedLibraryRoster,
  isAssessedVariant,
} from "../../../harness/src/shared/compatibility-mapping";

/** Slugs whose `manifest.yaml` says `deployed: false`. */
export function readUndeployedSlugs(repo: string): Set<string> {
  const integrations = join(repo, "showcase", "integrations");
  const undeployed = new Set<string>();
  for (const slug of readdirSync(integrations)) {
    let manifest: string;
    try {
      manifest = readFileSync(
        join(integrations, slug, "manifest.yaml"),
        "utf8",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (/^deployed:\s*false\b/m.test(manifest)) undeployed.add(slug);
  }
  return undeployed;
}
