const REGISTRY = "https://registry.npmjs.org";

type PublishedVersions = Record<string, { dist?: { integrity?: string } }>;

/**
 * The versions npm lists for `name`, or null when it was never published.
 * Any other failure throws.
 */
async function fetchVersionMap(
  name: string,
): Promise<PublishedVersions | null> {
  const response = await fetch(`${REGISTRY}/${name.replace("/", "%2f")}`, {
    // The abbreviated packument: versions without readmes or full manifests.
    headers: { accept: "application/vnd.npm.install-v1+json" },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `npm registry returned ${response.status} for ${name}; cannot tell which versions are taken.`,
    );
  }
  const { versions } = (await response.json()) as {
    versions?: PublishedVersions;
  };
  if (!versions || typeof versions !== "object") {
    throw new Error(
      `npm registry response for ${name} has no versions; cannot tell which versions are taken.`,
    );
  }
  return versions;
}

/**
 * Every version of `name` on npm, or none when it was never published.
 *
 * Any other failure throws. A caller picking the next version from this list
 * must not guess, or it hands out a version npm will refuse.
 */
export async function fetchPublishedVersions(name: string): Promise<string[]> {
  return Object.keys((await fetchVersionMap(name)) ?? {});
}

/**
 * The `dist.integrity` npm recorded for `name@version`, or null while the
 * registry does not list that version.
 */
export async function fetchPublishedIntegrity(
  name: string,
  version: string,
): Promise<string | null> {
  return (await fetchVersionMap(name))?.[version]?.dist?.integrity ?? null;
}
