const REGISTRY = "https://registry.npmjs.org";

/**
 * Every version of `name` on npm, or none when it was never published.
 *
 * Any other failure throws. A caller picking the next version from this list
 * must not guess, or it hands out a version npm will refuse.
 *
 * npm's CDN keeps a version list for up to five minutes. A unique query string
 * skips that copy, so a version published since is not missed.
 */
export async function fetchPublishedVersions(name: string): Promise<string[]> {
  const url = `${REGISTRY}/${name.replace("/", "%2f")}?fresh=${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const response = await fetch(url, {
    // The abbreviated packument: versions without readmes or full manifests.
    headers: { accept: "application/vnd.npm.install-v1+json" },
    cache: "no-store",
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

/**
 * Waits until npm lists each `name@version`.
 *
 * `npm publish` returns before npm adds the version to the package's version
 * list, sometimes minutes before. A release-candidate run that starts in that
 * window reads the old list and picks the same version again, which npm then
 * refuses. Waiting here keeps the next run from starting until npm lists this
 * run's versions.
 */
export async function waitForPublishedVersions(
  packages: { name: string; version: string }[],
  { timeoutMs = 10 * 60_000, intervalMs = 10_000 } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let missing = packages;
  for (;;) {
    const listed = await Promise.all(
      missing.map(async (p) =>
        (await fetchPublishedVersions(p.name)).includes(p.version),
      ),
    );
    missing = missing.filter((_, i) => !listed[i]);
    if (missing.length === 0) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `npm does not list ${missing.map((p) => `${p.name}@${p.version}`).join(", ")} yet. They are published, but the next release candidate can pick the same version until npm lists them.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
