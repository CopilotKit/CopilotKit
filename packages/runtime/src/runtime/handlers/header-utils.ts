/**
 * Exact header names (lowercased) stripped from forwarding by default.
 *
 * These are infrastructure/proxy/platform artifacts that no legitimate agent
 * integration depends on receiving *forwarded from the inbound edge* — the
 * inbound request has already traversed a browser, CDN/edge, load balancer, and
 * hosting platform, each of which stamps its own `x-*` headers. Forwarding them
 * verbatim to an arbitrary configured agent URL leaks client topology and, in
 * the Copilot Cloud case, a platform credential (#5712).
 *
 * `x-amz-cf-id` and `x-copilotcloud-public-api-key` are also covered by the
 * `x-amz-` / `x-copilotcloud-` prefixes below; the exact entries are kept
 * intentionally as documentation anchors for the highest-severity headers
 * (notably the platform API key), not as drift/oversight.
 */
export const DEFAULT_DENY_HEADER_NAMES: ReadonlySet<string> = new Set([
  // Hop-by-hop / proxy topology
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-server",
  "x-real-ip",
  // Cloud / CDN tracing + infra
  "x-amzn-trace-id",
  "x-amz-cf-id",
  "x-cloud-trace-context",
  "x-cache",
  "x-served-by",
  "x-request-id",
  // CopilotKit platform credentials/identifiers
  "x-copilotcloud-public-api-key",
]);

/**
 * Header-name prefixes (lowercased) stripped from forwarding by default.
 *
 * Prefix matching covers the well-known platform/CDN families so a new member
 * of a family (e.g. a future `x-vercel-foo`) is denied without a constant edit.
 */
export const DEFAULT_DENY_HEADER_PREFIXES: readonly string[] = [
  "x-amz-", // AWS
  "x-azure-", // Azure Front Door
  "x-fastly-", // Fastly
  "x-vercel-", // Vercel
  "x-middleware-", // Next.js
  "x-copilotcloud-", // CopilotKit platform-internal
];

/**
 * Fully-resolved inbound-header forwarding policy read by the call sites.
 *
 * Distinct from the public `ForwardHeadersConfig` option an integrator passes:
 * the runtime resolves that option ONCE in its constructor into this shape
 * (lowercasing names/prefixes, defaulting `useDefaultDenylist`, building the
 * `allow` set) so the predicate stays branch-simple and the policy can never be
 * re-resolved divergently at a call site. See `resolveForwardHeadersPolicy`.
 */
export interface ResolvedForwardHeadersPolicy {
  /** When true, the built-in infra/platform denylist is active. */
  useDefaultDenylist: boolean;
  /** Extra exact names to strip (lowercased). */
  denyNames: ReadonlySet<string>;
  /** Extra prefixes to strip (lowercased). */
  denyPrefixes: readonly string[];
  /**
   * If set, allowlist mode: ONLY these (lowercased) names are candidates to
   * forward — and `denyNames` / `denyPrefixes` still subtract from them.
   */
  allow?: ReadonlySet<string>;
}

/**
 * Public, integrator-facing config for inbound-header forwarding. Resolved into
 * a {@link ResolvedForwardHeadersPolicy} by {@link resolveForwardHeadersPolicy}.
 */
export interface ForwardHeadersConfig {
  /** Strip the built-in infra/platform denylist. @default true */
  useDefaultDenylist?: boolean;
  /** Additional exact header names to strip (case-insensitive). */
  deny?: string[];
  /** Additional header-name prefixes to strip (case-insensitive). */
  denyPrefixes?: string[];
  /**
   * If set (with at least one non-empty entry), switch to allowlist mode: ONLY
   * these headers are candidates to forward, overriding the default `x-*` /
   * `authorization` eligibility (case-insensitive). `deny` / `denyPrefixes`
   * still apply and subtract from this set — a header listed in both `allow` and
   * `deny` is NOT forwarded.
   *
   * Footgun: in allowlist mode the built-in DEFAULT denylist (and
   * `useDefaultDenylist`) is BYPASSED — only your `allow` set, minus your own
   * `deny` / `denyPrefixes`, is forwarded. Do NOT allow-list protected/platform
   * headers (e.g. `x-copilotcloud-public-api-key`, `x-forwarded-*`) unless you
   * truly intend to forward them, since the default protection does not apply
   * here.
   */
  allow?: string[];
}

/**
 * Normalizes a public {@link ForwardHeadersConfig} (or `undefined`) into a
 * fully-resolved {@link ResolvedForwardHeadersPolicy}.
 *
 * - `useDefaultDenylist` defaults to `true` (the built-in denylist is active
 *   on upgrade); pass `false` to restore the previous wide-open behavior.
 * - `deny` / `denyPrefixes` extend (do not replace) the defaults.
 * - `allow` activates allowlist mode only when it has at least one non-empty
 *   entry after normalization.
 *
 * All names/prefixes are trimmed, lowercased, and stripped of empty/
 * whitespace-only entries before use. Trimming/lowercasing keeps matching a
 * plain set/prefix check against the lowercased inbound keys; dropping empties
 * is a safety guard: a stray `denyPrefixes: [""]` would make `startsWith("")`
 * true for every header (silently denying ALL forwarding). Because empties are
 * dropped BEFORE the allowlist-mode decision, an `allow: [""]` / `allow: [" "]`
 * normalizes to an empty set and does NOT switch on allowlist mode — the runtime
 * stays in denylist mode. Allowlist mode activates only when `allow` has at
 * least one non-empty entry; these empty/whitespace-only entries are integrator
 * typos, not intent, so we filter them.
 */
function normalizeHeaderEntries(entries: string[] | undefined): string[] {
  return (entries ?? [])
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

export function resolveForwardHeadersPolicy(
  config: ForwardHeadersConfig | undefined,
): ResolvedForwardHeadersPolicy {
  const denyNames = new Set<string>(normalizeHeaderEntries(config?.deny));
  const denyPrefixes = normalizeHeaderEntries(config?.denyPrefixes);
  const allowEntries = normalizeHeaderEntries(config?.allow);
  const allow =
    allowEntries.length > 0 ? new Set<string>(allowEntries) : undefined;

  return {
    useDefaultDenylist: config?.useDefaultDenylist ?? true,
    denyNames,
    denyPrefixes,
    allow,
  };
}

/**
 * True iff the (already-lowercased) header name matches the integrator's OWN
 * `deny` / `denyPrefixes`. This is the authoritative subtractive check: it is
 * consulted in BOTH allowlist and denylist mode. It deliberately does NOT
 * include the built-in {@link DEFAULT_DENY_HEADER_NAMES} /
 * {@link DEFAULT_DENY_HEADER_PREFIXES} — an explicit `allow` opts the integrator
 * back into a default-denied header on purpose, so only their own `deny`
 * subtracts from an allowlist.
 */
function matchesIntegratorDeny(
  lower: string,
  policy: ResolvedForwardHeadersPolicy,
): boolean {
  if (policy.denyNames.has(lower)) return true;
  return policy.denyPrefixes.some((prefix) => lower.startsWith(prefix));
}

/**
 * Determines if a header should be forwarded under the given resolved policy.
 *
 * The integrator's `deny` / `denyPrefixes` ALWAYS strip, including in allowlist
 * mode: `allow` selects the candidate set, `deny` removes from it. A header the
 * integrator lists in BOTH `allow` and `deny` is NOT forwarded — deny is
 * authoritative so a security-motivated `deny` can never be silently defeated
 * by an overlapping `allow` (the footgun this hardens against).
 *
 * Modes:
 * - Allowlist (`policy.allow` set): forward iff the name is in `allow` AND is
 *   NOT matched by the integrator's `deny` / `denyPrefixes`. Nothing else
 *   forwards — not even the usual `authorization` / `x-*` eligibility.
 * - Denylist (default): base eligibility is `authorization` or any `x-*`, then
 *   the built-in denylist (when enabled) and the integrator's own
 *   names/prefixes strip from that set.
 *
 * Note: the built-in default denylist applies ONLY in denylist mode; an
 * explicit `allow` is treated as the integrator deliberately opting back into
 * those headers, so only their OWN `deny` subtracts in allowlist mode.
 */
export function shouldForwardHeader(
  headerName: string,
  policy: ResolvedForwardHeadersPolicy,
): boolean {
  const lower = headerName.toLowerCase();

  // Allowlist mode: forward iff explicitly allowed AND not subtracted by the
  // integrator's own deny/denyPrefixes. Nothing else forwards — not even the
  // usual `authorization` / `x-*` eligibility.
  if (policy.allow) {
    return policy.allow.has(lower) && !matchesIntegratorDeny(lower, policy);
  }

  // Base eligibility (unchanged): authorization + any x-*.
  const eligible = lower === "authorization" || lower.startsWith("x-");
  if (!eligible) return false;

  // Built-in denylist (default-on): strip known infra/platform headers.
  if (policy.useDefaultDenylist) {
    if (DEFAULT_DENY_HEADER_NAMES.has(lower)) return false;
    if (
      DEFAULT_DENY_HEADER_PREFIXES.some((prefix) => lower.startsWith(prefix))
    ) {
      return false;
    }
  }

  // Integrator-supplied additions extend the denylist regardless of the default.
  if (matchesIntegratorDeny(lower, policy)) return false;

  return true;
}

/**
 * Extracts headers that should be forwarded from a Request object, applying the
 * resolved forwarding policy. Keys are normalized to the lowercased form the
 * `Headers` iterator yields.
 */
export function extractForwardableHeaders(
  request: Request,
  policy: ResolvedForwardHeadersPolicy,
): Record<string, string> {
  const forwardableHeaders: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    if (shouldForwardHeader(key, policy)) {
      forwardableHeaders[key] = value;
    }
  });
  return forwardableHeaders;
}

/**
 * Merges forwardable inbound request headers onto the headers a server
 * explicitly configured on an agent, letting the SERVER-CONFIGURED headers WIN
 * on collision — a server-set service-to-service token (e.g. an IAM bearer)
 * must never be silently overridden by a browser/edge/platform-injected inbound
 * header (#5712).
 *
 * The collision check is case-insensitive: `extractForwardableHeaders`
 * normalizes inbound keys to lowercase (`authorization`) while the server
 * typically configures canonical casing (`Authorization`). A plain object
 * spread would treat those as distinct keys and emit BOTH — which downstream
 * (undici) comma-joins into a single invalid "multiple JWTs" value. So we drop
 * any forwarded header the agent already sets, matched case-insensitively, and
 * let non-colliding inbound headers pass through unchanged.
 *
 * The same comma-join hazard exists if the SERVER CONFIG ITSELF contains two
 * case-variants of one header (e.g. both `Authorization` and `authorization`
 * in `agent.headers`). A plain `{ ...serverHeaders }` spread would keep both,
 * so we additionally collapse server-self case-collisions to a SINGLE entry,
 * FIRST-OCCURRENCE WINS: the first key seen (in `Object.keys` order) keeps its
 * exact casing and value, and any later case-variant of that name is dropped.
 * Server-wins-over-inbound and case-insensitive inbound suppression are
 * otherwise unchanged.
 *
 * Breadth (which inbound headers are eligible to forward at all) is decided by
 * `policy` upstream in `extractForwardableHeaders` → `shouldForwardHeader`; the
 * merge never re-widens or re-narrows the set.
 */
export function mergeForwardableHeaders(
  serverHeaders: Record<string, string> | undefined,
  request: Request,
  policy: ResolvedForwardHeadersPolicy,
): Record<string, string> {
  const base = serverHeaders ?? {};
  const merged: Record<string, string> = {};
  const serverHeaderNames = new Set<string>();
  // Collapse server-self case-collisions: first occurrence wins, later
  // case-variants of the same name are dropped.
  for (const [name, value] of Object.entries(base)) {
    const lower = name.toLowerCase();
    if (serverHeaderNames.has(lower)) {
      continue;
    }
    serverHeaderNames.add(lower);
    merged[name] = value;
  }
  for (const [name, value] of Object.entries(
    extractForwardableHeaders(request, policy),
  )) {
    if (!serverHeaderNames.has(name.toLowerCase())) {
      merged[name] = value;
    }
  }
  return merged;
}
