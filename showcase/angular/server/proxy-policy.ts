export interface RuntimeRegistryInput {
  integrations: Array<{
    slug: string;
    demos: Array<{
      id: string;
      route?: string;
      highlight?: string[];
    }>;
  }>;
}

export interface RuntimeCatalogInput {
  cells: Array<{
    id: string;
    frontend: string;
    integration: string;
    feature: string;
    runnable: boolean;
  }>;
}

export interface RuntimeIndexEntry {
  cellId: string;
  runnable: boolean;
  runtimePrefix?: string;
}

export type RuntimeIndex = ReadonlyMap<string, RuntimeIndexEntry>;

export class ProxyPolicyError extends Error {
  constructor(
    public readonly code:
      | "unknown-cell"
      | "non-runnable-cell"
      | "invalid-runtime-path"
      | "method-not-allowed"
      | "invalid-backend-config",
    public readonly status: 404 | 405 | 503,
  ) {
    super(code);
    this.name = "ProxyPolicyError";
  }
}

const DEFAULT_RUNTIME_PREFIX = "/api/copilotkit";
const RUNTIME_SOURCE_RE =
  /^src\/app(\/api\/copilotkit(?:-[a-z0-9-]+)?)(?:\/.*)?\/route\.(?:ts|js)$/;

function runtimePrefixFromHighlight(highlight: readonly string[]): string {
  for (const file of highlight) {
    const match = RUNTIME_SOURCE_RE.exec(file);
    if (match) return match[1];
  }
  return DEFAULT_RUNTIME_PREFIX;
}

/** Build the immutable Angular cell -> server-owned runtime-prefix index. */
export function buildRuntimeIndex(
  registry: RuntimeRegistryInput,
  catalog: RuntimeCatalogInput,
): RuntimeIndex {
  const demos = new Map<
    string,
    RuntimeRegistryInput["integrations"][number]["demos"][number]
  >();
  for (const integration of registry.integrations) {
    for (const demo of integration.demos) {
      demos.set(`${integration.slug}/${demo.id}`, demo);
    }
  }

  const entries = new Map<string, RuntimeIndexEntry>();
  for (const cell of catalog.cells) {
    if (cell.frontend !== "angular") continue;
    const demo = demos.get(`${cell.integration}/${cell.feature}`);
    entries.set(`${cell.integration}/${cell.feature}`, {
      cellId: cell.id,
      runnable: cell.runnable,
      ...(cell.runnable && demo?.route
        ? {
            runtimePrefix: runtimePrefixFromHighlight(demo.highlight ?? []),
          }
        : {}),
    });
  }
  return entries;
}

interface AllowedRuntimeRoute {
  pattern: RegExp;
  methods: readonly string[];
}

const ALLOWED_RUNTIME_ROUTES: readonly AllowedRuntimeRoute[] = [
  { pattern: /^$/, methods: ["POST"] },
  { pattern: /^\/info$/, methods: ["GET"] },
  { pattern: /^\/transcribe$/, methods: ["POST"] },
  { pattern: /^\/annotate$/, methods: ["POST"] },
  {
    pattern: /^\/agent\/[A-Za-z0-9._~-]+\/(?:run|connect|suggest)$/,
    methods: ["POST"],
  },
  {
    pattern: /^\/agent\/[A-Za-z0-9._~-]+\/stop\/[A-Za-z0-9._~%+-]+$/,
    methods: ["POST"],
  },
  { pattern: /^\/threads$/, methods: ["GET"] },
  { pattern: /^\/threads\/subscribe$/, methods: ["POST"] },
  { pattern: /^\/threads\/clear$/, methods: ["DELETE"] },
  {
    pattern: /^\/threads\/[A-Za-z0-9._~%+-]+$/,
    methods: ["PATCH", "DELETE"],
  },
  {
    pattern: /^\/threads\/[A-Za-z0-9._~%+-]+\/(?:messages|events|state)$/,
    methods: ["GET"],
  },
  {
    pattern: /^\/threads\/[A-Za-z0-9._~%+-]+\/archive$/,
    methods: ["POST"],
  },
  { pattern: /^\/memories$/, methods: ["GET", "POST"] },
  { pattern: /^\/memories\/subscribe$/, methods: ["POST"] },
  {
    pattern: /^\/memories\/[A-Za-z0-9._~%+-]+$/,
    methods: ["PATCH", "DELETE"],
  },
];

function validateRuntimeSuffix(suffix: string, method: string): string {
  if (
    suffix.includes("?") ||
    suffix.includes("#") ||
    suffix.includes("\\") ||
    /%(?:2e|2f|5c)/i.test(suffix)
  ) {
    throw new ProxyPolicyError("invalid-runtime-path", 404);
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(suffix);
  } catch {
    throw new ProxyPolicyError("invalid-runtime-path", 404);
  }
  if (
    decoded !== suffix ||
    (!suffix.startsWith("/") && suffix !== "") ||
    suffix.includes("//") ||
    suffix.split("/").includes("..")
  ) {
    throw new ProxyPolicyError("invalid-runtime-path", 404);
  }

  const route = ALLOWED_RUNTIME_ROUTES.find(({ pattern }) =>
    pattern.test(suffix),
  );
  if (!route) {
    throw new ProxyPolicyError("invalid-runtime-path", 404);
  }
  if (!route.methods.includes(method.toUpperCase())) {
    throw new ProxyPolicyError("method-not-allowed", 405);
  }
  return suffix;
}

const LOOPBACK_OR_PRIVATE_HOST_RE =
  /^(?:localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[::1\])$/i;

function backendBaseUrl(
  pattern: string,
  integration: string,
  production: boolean,
): URL {
  if (
    !pattern.includes("{slug}") ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(pattern) ||
    /[?#\s]/.test(pattern)
  ) {
    throw new ProxyPolicyError("invalid-backend-config", 503);
  }
  const expanded = pattern.replaceAll("{slug}", integration);
  const local = /^(?:localhost|127\.|\[::1\])(?::|\/|$)/i.test(expanded);
  let parsed: URL;
  try {
    parsed = new URL(`${local ? "http" : "https"}://${expanded}`);
  } catch {
    throw new ProxyPolicyError("invalid-backend-config", 503);
  }
  if (
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.hostname.length === 0 ||
    (production && parsed.protocol !== "https:") ||
    (production && parsed.pathname !== "/") ||
    (production && LOOPBACK_OR_PRIVATE_HOST_RE.test(parsed.hostname))
  ) {
    throw new ProxyPolicyError("invalid-backend-config", 503);
  }
  return parsed;
}

/** Validate server-only backend routing configuration without exposing it. */
export function validateBackendHostPattern(
  pattern: string,
  production: boolean,
): void {
  backendBaseUrl(pattern, "probe", production);
}

/** Resolve a browser cell identity and allowlisted suffix to a server target. */
export function resolveProxyTarget(input: {
  index: RuntimeIndex;
  integration: string;
  feature: string;
  suffix: string;
  method: string;
  backendHostPattern: string;
  production: boolean;
}): { cellId: string; targetUrl: string } {
  const entry = input.index.get(`${input.integration}/${input.feature}`);
  if (!entry) throw new ProxyPolicyError("unknown-cell", 404);
  if (!entry.runnable || !entry.runtimePrefix) {
    throw new ProxyPolicyError("non-runnable-cell", 404);
  }

  const suffix = validateRuntimeSuffix(input.suffix, input.method);
  const base = backendBaseUrl(
    input.backendHostPattern,
    input.integration,
    input.production,
  );
  const basePath = base.pathname.replace(/\/$/, "");
  base.pathname = `${basePath}${entry.runtimePrefix}${suffix}`;

  return { cellId: entry.cellId, targetUrl: base.toString() };
}
