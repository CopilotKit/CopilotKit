import { fetchPublishedVersions } from "./npm-registry.js";

/**
 * What npm already holds for a set of packages about to be published.
 */
export interface RegistryCheck {
  /**
   * Packages npm has never seen. Trusted publishing cannot create a package,
   * so publishing one of these fails with ENEEDAUTH, after the packages ahead
   * of it in the run have already shipped.
   */
  unregistered: string[];
  /** `name@version` for each package whose version npm already has. */
  published: string[];
}

/**
 * Look every package up on npm before publishing any of them, so a run that
 * cannot finish fails before its first publish rather than halfway through.
 */
export async function checkRegistry(
  packages: ReadonlyArray<{ name: string; version: string }>,
  fetchVersions: (name: string) => Promise<string[]> = fetchPublishedVersions,
): Promise<RegistryCheck> {
  const versions = await Promise.all(
    packages.map((p) => fetchVersions(p.name)),
  );
  const check: RegistryCheck = { unregistered: [], published: [] };
  packages.forEach((p, i) => {
    if (versions[i].length === 0) check.unregistered.push(p.name);
    else if (versions[i].includes(p.version))
      check.published.push(`${p.name}@${p.version}`);
  });
  return check;
}

/** How to get a package npm has never seen ready for the publish workflow. */
export function unregisteredHelp(names: readonly string[]): string {
  return [
    `Never published to npm: ${names.join(", ")}.`,
    "npm trusted publishing cannot create a package. An npm owner has to publish a placeholder version of each by hand once,",
    "then add its trusted publisher (repository CopilotKit/CopilotKit, workflow publish-release.yml, environment npm) and re-run.",
  ].join("\n");
}
