const REGISTRY = "https://registry.npmjs.org";

/**
 * Every version of `name` on npm, or none when it was never published.
 *
 * Any other failure throws. A caller picking the next version from this list
 * must not guess, or it hands out a version npm will refuse.
 */
export async function fetchPublishedVersions(name: string): Promise<string[]> {
  const response = await fetch(`${REGISTRY}/${name.replace("/", "%2f")}`, {
    // The abbreviated packument: versions without readmes or full manifests.
    headers: { accept: "application/vnd.npm.install-v1+json" },
  });
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error(
      `npm registry returned ${response.status} for ${name}; cannot tell which versions are taken.`,
    );
  }
  const { versions } = (await response.json()) as {
    versions?: Record<string, unknown>;
  };
  if (!versions || typeof versions !== "object") {
    throw new Error(
      `npm registry response for ${name} has no versions; cannot tell which versions are taken.`,
    );
  }
  return Object.keys(versions);
}
