// Every docs version, and where each one lives on docs.copilotkit.ai.
//
// Each version is its own deployment. The stable version serves the root
// (`path: ""`); every other version is built with `DOCS_BASE_PATH` set to its
// `path`, and the stable site forwards that path to it (next.config.mjs). The
// stable site also serves this list at /versions.json, so a version that is
// no longer built still learns about newer ones in its picker.
//
// Keep this file the same on every branch that builds docs. At a major
// release, give the new version `path: ""` and the old one its prefix.

/**
 * @typedef {object} DocsVersion
 * @property {string} id      The URL prefix without its slash: "v1", "v2".
 * @property {string} label   What the picker shows: "v2.x".
 * @property {string} note    The version's state: "Stable", "Release candidate".
 * @property {string} path    "" for the stable version, else "/<id>".
 * @property {string} [originEnv] The stable site's variable that names this
 *   version's deployment (its private Railway URL), for forwarding.
 */

/** @type {DocsVersion[]} */
export const DOCS_VERSIONS = [
  {
    id: "v2",
    label: "v2.x",
    note: "Release candidate",
    path: "/v2",
    originEnv: "DOCS_V2_ORIGIN",
  },
  { id: "v1", label: "v1.x", note: "Stable", path: "" },
];

/**
 * A base path from the environment, as Next.js wants it: "" or "/segment",
 * with no trailing slash.
 * @param {string | undefined} value
 */
export function normalizeBasePath(value) {
  const trimmed = (value ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}
