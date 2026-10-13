import { LEARNING_PREVIEW } from "./config.js";
import { mapWithConcurrency } from "./concurrency.js";
import type { PublishablePackage } from "./versions.js";
import type { PackedManifest } from "./pack-workspace.js";

export const LEARNING_PACKAGE = "@copilotkit/learning";

/** Check the artifact that npm will receive, after pnpm's workspace rewrite. */
export function verifyPackedLearningPreview(
  selector: string,
  packages: PublishablePackage[],
  manifest: PackedManifest,
) {
  if (selector !== LEARNING_PREVIEW || manifest.name !== "@copilotkit/core")
    return;
  const learning = packages.find((pkg) => pkg.name === LEARNING_PACKAGE);
  if (
    !learning ||
    manifest.dependencies?.[LEARNING_PACKAGE] !== learning.pkg.version
  ) {
    throw new Error(
      "Packed Core must pin the exact same-run Learning preview version.",
    );
  }
}

/**
 * Preview consumers must not ship before their same-run Learning dependency.
 * Other selectors retain the existing concurrent publish behavior. npm cannot
 * publish atomically: any failure still requires a fresh canary identifier.
 */
export async function publishPrereleasePackages<T>(
  selector: string,
  packages: PublishablePackage[],
  limit: number,
  publish: (pkg: PublishablePackage) => Promise<T>,
) {
  if (selector !== LEARNING_PREVIEW) {
    return mapWithConcurrency(packages, limit, publish);
  }

  const learning = packages.filter((pkg) => pkg.name === LEARNING_PACKAGE);
  if (learning.length !== 1) {
    throw new Error(
      "Learning preview must contain exactly one Learning package.",
    );
  }
  const prerequisite = await mapWithConcurrency(learning, limit, publish);
  if (prerequisite.some((result) => result.error)) return prerequisite;

  const consumers = packages.filter((pkg) => pkg.name !== LEARNING_PACKAGE);
  return [
    ...prerequisite,
    ...(await mapWithConcurrency(consumers, limit, publish)),
  ];
}
