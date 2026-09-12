/**
 * Round-trips the setup wizard's four selections (project, frontend,
 * features, backend) through a URL query string.
 *
 * This module is deliberately DOM-free: no `window`, no `history`, no
 * React. The wizard component owns the actual state and calls
 * `serializeWizardUrlState` / `parseWizardUrlState` as pure functions, so
 * this file can be unit-tested without a browser and reused anywhere a
 * query string needs to carry the same four values (e.g. a server-side
 * redirect).
 *
 * `search` handed to `parseWizardUrlState` is untrusted input straight off
 * a URL bar -- a stale bookmark, a hand-edited link, or a deliberately
 * hostile one. Every value is checked against an allow-list supplied by
 * the caller; nothing here trusts the string itself, and nothing here
 * indexes an object with a URL-supplied key (see the `constructor` /
 * `__proto__` note below).
 */

export type WizardUrlState = {
  /** The wizard's first question -- "Do you already have a project?" --
   *  answered as one of the caller's `projectAnswers` ids (in practice
   *  `"yes"` / `"no"`). Named and validated exactly like `frontend` and
   *  `backend` below, not specially. */
  readonly project?: string;
  readonly frontend?: string;
  readonly features: readonly string[];
  readonly backend?: string;
};

export type WizardUrlAllowlists = {
  readonly projectAnswers: readonly string[];
  readonly frontends: readonly string[];
  readonly features: readonly string[];
  readonly backends: readonly string[];
};

/**
 * Serializes to a query string with no leading `?`, so the caller can
 * check for `""` and decide whether writing a URL is even worthwhile.
 *
 * Key order is fixed (project, frontend, features, backend) rather than
 * insertion order, so the resulting URL is stable and diff-friendly across
 * calls. A key whose value is absent or empty is omitted entirely -- an
 * empty `features=` or a literal `frontend=undefined` would parse back
 * into a wrong, non-empty selection.
 *
 * `URLSearchParams` percent-encodes `,` (as `%2C`) along with everything
 * else it escapes. We deliberately do NOT use it for the `features`
 * value: comma is not a URL meta-character (it needs no encoding inside
 * a query value) and a raw `features=chat,hitl` is materially more
 * readable and shareable than `features=chat%2Chitl`. Feature ids in
 * this codebase are always simple slugs (see the allow-lists), so no
 * value can itself legally contain a comma, `&`, or `=` -- there is no
 * ambiguity to encode away. `frontend` and `backend` still go through
 * `URLSearchParams` since they are single opaque values with no reason
 * to hand-roll encoding for.
 */
export function serializeWizardUrlState(state: WizardUrlState): string {
  const parts: string[] = [];

  if (state.project) {
    const params = new URLSearchParams();
    params.set("project", state.project);
    parts.push(params.toString());
  }

  if (state.frontend) {
    const params = new URLSearchParams();
    params.set("frontend", state.frontend);
    parts.push(params.toString());
  }

  if (state.features.length > 0) {
    parts.push(`features=${state.features.map(encodeURIComponent).join(",")}`);
  }

  if (state.backend) {
    const params = new URLSearchParams();
    params.set("backend", state.backend);
    parts.push(params.toString());
  }

  return parts.join("&");
}

/**
 * Returns the first value of a repeated query key, e.g. for
 * `?frontend=vue&frontend=react` this returns `"vue"`. We take the first
 * occurrence -- not the last -- because that mirrors how every other
 * "first wins" ambiguity in this module is resolved (allow-list order
 * over URL order below) and because the first value is the one a human
 * skimming the URL from left to right would call authoritative; a
 * duplicated key is far more likely to be a copy/paste accident that
 * appended a second value than a deliberate override of the first.
 */
function firstValue(params: URLSearchParams, key: string): string | undefined {
  return params.getAll(key).at(0);
}

/**
 * Membership check against an allow-list without ever indexing an object
 * by a URL-supplied string. This project already shipped a
 * prototype-pollution-shaped bug on this very page by looking up a
 * URL-controlled key on a plain object (`obj[key]`), which resolves
 * inherited properties like `constructor` or `__proto__` instead of
 * failing closed. Array membership (`includes`) has no prototype chain
 * to leak, so `"constructor"` and `"__proto__"` are rejected exactly like
 * any other id that isn't in the list.
 */
function isAllowed(value: string, allowlist: readonly string[]): boolean {
  return allowlist.includes(value);
}

export function parseWizardUrlState(
  search: string,
  allowed: WizardUrlAllowlists,
): WizardUrlState {
  // `URLSearchParams` already strips a single leading "?" per spec, so
  // "?frontend=vue", "frontend=vue", and "" all parse correctly as-is.
  const params = new URLSearchParams(search);

  const rawProject = firstValue(params, "project");
  const project =
    rawProject !== undefined && isAllowed(rawProject, allowed.projectAnswers)
      ? rawProject
      : undefined;

  const rawFrontend = firstValue(params, "frontend");
  const frontend =
    rawFrontend !== undefined && isAllowed(rawFrontend, allowed.frontends)
      ? rawFrontend
      : undefined;

  const rawBackend = firstValue(params, "backend");
  const backend =
    rawBackend !== undefined && isAllowed(rawBackend, allowed.backends)
      ? rawBackend
      : undefined;

  const rawFeatures = firstValue(params, "features") ?? "";
  const requested = new Set(
    rawFeatures
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  );
  // Returned in allow-list order (not URL order) so the rendered
  // selection is stable no matter how the link was hand-written, and
  // de-duplicated implicitly since `allowed.features` itself has no
  // duplicates and we filter it down rather than filtering the URL's
  // (possibly repeated) list up.
  const features = allowed.features.filter((id) => requested.has(id));

  return { project, frontend, features, backend };
}
