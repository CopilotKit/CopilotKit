// The path this build of the docs is served under: "" for the stable docs at
// the root of docs.copilotkit.ai, "/v2" for the 2.x docs, and so on
// (src/lib/docs-versions.mjs). next.config.mjs inlines DOCS_BASE_PATH.
//
// Next.js adds the base path to its own links, router calls and /_next assets.
// It does not touch plain strings: an <img src="/images/x.png">, a
// fetch("/api/..."), or a runtimeUrl. Those go through `withBasePath`.

export const basePath = process.env.DOCS_BASE_PATH ?? "";

/** A root-relative path under this build's base path. Other URLs pass through. */
export function withBasePath(path: string): string {
  if (!basePath || !path.startsWith("/") || path.startsWith("//")) return path;
  if (path === basePath || path.startsWith(`${basePath}/`)) return path;
  return `${basePath}${path}`;
}
