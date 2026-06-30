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
  /** If set, allowlist mode: ONLY these (lowercased) names forward. */
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
   * If set, switch to allowlist mode: ONLY these headers forward, overriding
   * the default `x-*` / `authorization` eligibility (case-insensitive).
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
 * - `allow`, if non-empty, switches to allowlist mode.
 *
 * All names/prefixes are lowercased so matching against the lowercased inbound
 * keys is a plain set/prefix check.
 */
export function resolveForwardHeadersPolicy(
  config: ForwardHeadersConfig | undefined,
): ResolvedForwardHeadersPolicy {
  const denyNames = new Set<string>(
    (config?.deny ?? []).map((name) => name.toLowerCase()),
  );
  const denyPrefixes = (config?.denyPrefixes ?? []).map((prefix) =>
    prefix.toLowerCase(),
  );
  const allowList = config?.allow;
  const allow =
    allowList && allowList.length > 0
      ? new Set<string>(allowList.map((name) => name.toLowerCase()))
      : undefined;

  return {
    useDefaultDenylist: config?.useDefaultDenylist ?? true,
    denyNames,
    denyPrefixes,
    allow,
  };
}

/**
 * Determines if a header should be forwarded under the given resolved policy.
 *
 * Modes:
 * - Allowlist (`policy.allow` set): forward iff the name is explicitly allowed.
 * - Denylist (default): base eligibility is `authorization` or any `x-*`, then
 *   the built-in denylist (when enabled) and any integrator-supplied
 *   names/prefixes strip from that set.
 */
export function shouldForwardHeader(
  headerName: string,
  policy: ResolvedForwardHeadersPolicy,
): boolean {
  const lower = headerName.toLowerCase();

  // Allowlist mode: forward iff explicitly allowed; nothing else, not even the
  // usual `authorization` / `x-*` eligibility.
  if (policy.allow) {
    return policy.allow.has(lower);
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
  if (policy.denyNames.has(lower)) return false;
  if (policy.denyPrefixes.some((prefix) => lower.startsWith(prefix))) {
    return false;
  }

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
