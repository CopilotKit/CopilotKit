// Whether search engines may index this deployment. One image serves staging
// and then production (docs_promote.yml), so it's read from the environment
// at request time: set `DOCS_NOINDEX=1` on a deployment that crawlers should
// skip (docs.staging.copilotkit.ai). Production leaves it unset.

export function isIndexable(): boolean {
  // A computed key, so Next can't inline the build's value.
  const key = "DOCS_NOINDEX";
  const value = process.env[key]?.trim().toLowerCase();
  return !value || value === "0" || value === "false";
}
