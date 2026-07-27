#!/usr/bin/env npx tsx
/**
 * deploy-to-railway.ts — Create or update a Railway service for a showcase integration.
 *
 * Reads the package's manifest.yaml and creates the Railway service via
 * GraphQL API, pulling the image from GHCR.
 *
 * Usage:
 *   npx tsx showcase/scripts/deploy-to-railway.ts <slug>
 *   npx tsx showcase/scripts/deploy-to-railway.ts mastra
 *   npx tsx showcase/scripts/deploy-to-railway.ts --list          # list existing showcase services
 *   npx tsx showcase/scripts/deploy-to-railway.ts --go-live <slug> # flip deployed: true + redeploy
 *
 * Requires: RAILWAY_TOKEN env var or ~/.railway/config.json
 */

import fs from "fs";
import path from "path";
import yaml from "yaml";
import { fileURLToPath } from "url";
import { RAILWAY_GRAPHQL_ENDPOINT } from "./lib/railway-graphql";
import { RailwayTokenError, resolveRailwayToken } from "./lib/railway-token";
import {
  PROJECT_ID,
  PRODUCTION_ENV_ID,
  healthcheckPathFor,
  isTrackedService,
} from "./railway-envs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PACKAGES_DIR = path.join(ROOT, "integrations");

const RAILWAY_API = RAILWAY_GRAPHQL_ENDPOINT;

const SHOWCASE = {
  projectId: PROJECT_ID,
  environmentId: PRODUCTION_ENV_ID,
};

/**
 * Resolve the healthcheck path to apply to a Railway service instance during
 * provisioning, disambiguating the two reasons {@link healthcheckPathFor}
 * returns undefined:
 *
 *   - `{ kind: "set", path }`     — a tracked service with an explicit SSOT
 *                                   healthcheckPath (e.g. aimock → `/health`,
 *                                   agents → `/api/health`). Apply that path.
 *   - `{ kind: "omit" }`          — a TRACKED service that deliberately has a
 *                                   null/omitted healthcheckPath (dashboard,
 *                                   docs, dojo, webhooks, pocketbase). These
 *                                   have no HTTP health endpoint; forcing
 *                                   `/api/health` 404s and wedges the deploy.
 *                                   Set NO healthcheck (Railway default).
 *   - `{ kind: "set", path: "/api/health" }` for an UNTRACKED service — a
 *                                   brand-new/unknown service this script is
 *                                   onboarding takes the agent-class default.
 *
 * Pure (SSOT lookup only) so both createService and goLive share one source
 * of truth and it is unit-testable without network I/O.
 */
export function resolveProvisionHealthcheck(
  serviceName: string,
): { kind: "set"; path: string } | { kind: "omit" } {
  if (!isTrackedService(serviceName)) {
    // Not in the SSOT at all — agent-class default for a new service.
    return { kind: "set", path: "/api/health" };
  }
  const trackedPath = healthcheckPathFor(serviceName, "prod");
  // Tracked-null → omit the healthcheck (no HTTP health endpoint).
  return trackedPath === undefined
    ? { kind: "omit" }
    : { kind: "set", path: trackedPath };
}

/**
 * Resolve the Railway bearer token for this run. Wraps the shared
 * `resolveRailwayToken` envelope and maps any RailwayTokenError onto
 * the script's exit-1 contract for operator/config errors. The shared
 * helper never calls process.exit — exit-code mapping lives HERE so the
 * helper stays unit-testable.
 *
 * Memoized at module scope so the Railway config isn't re-read and the
 * deprecation warning isn't re-emitted on every GraphQL request. A
 * failure is NOT cached — the first call's error still maps to exit 1
 * (or rethrows for non-RailwayTokenError), so a transient/operator
 * error remains fail-loud and a subsequent run gets a fresh resolution.
 */
let cachedToken: string | undefined;
function getToken(): string {
  if (cachedToken) return cachedToken;
  try {
    cachedToken = resolveRailwayToken().token;
    return cachedToken;
  } catch (e) {
    if (e instanceof RailwayTokenError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
}

// ── GHCR digest resolution ─────────────────────────────────────────────
//
// Prod services must be born PINNED to a content-addressable digest
// (`@sha256:...`), never the mutable `:latest` tag — otherwise a freshly
// provisioned prod service silently tracks `:latest` until a later
// `bin/railway promote` re-pins it, and in that window a regressed
// `:latest` flows straight into prod. This mirrors the Ruby promote CLI
// (`showcase/bin/railway`, class GHCR) so the two stay behaviorally
// identical.
//
// GHCR exposes the OCI Distribution Spec at
//   https://ghcr.io/v2/<org>/<image>/manifests/<tag>
// but its manifest endpoint REJECTS a raw GitHub/Actions token sent as
// `Authorization: Bearer <token>` with HTTP 403 — the token must first be
// exchanged for a short-lived registry bearer via the /token endpoint. So
// we ALWAYS hit /token, even when a token is present.

const GHCR_ORG = "copilotkit";
const GHCR_ACCEPT_MANIFEST = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

/**
 * Minimal HTTP response shape — only the bits the resolver reads. Injected
 * so the resolver core is unit-testable without real network I/O.
 */
export interface GhcrHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface GhcrHttp {
  get(url: string, headers: Record<string, string>): Promise<GhcrHttpResponse>;
  head(url: string, headers: Record<string, string>): Promise<GhcrHttpResponse>;
}

/**
 * GHCR bearer (PAT) for manifest reads. Distinct from the Railway token.
 * Order mirrors the Ruby CLI:
 *   1. GHCR_TOKEN   — explicit PAT (local dev or CI override).
 *   2. GITHUB_TOKEN — GitHub Actions automatic token (needs packages:read).
 * Returns undefined when neither is set (public-package anonymous reads
 * still succeed via the /token exchange).
 */
export function ghcrPat(): string | undefined {
  const t = (process.env.GHCR_TOKEN || process.env.GITHUB_TOKEN || "").trim();
  return t || undefined;
}

/** Flatten a fetch Headers into a plain record keyed BOTH as-sent and
 * lower-cased, so callers can read `Docker-Content-Digest` case-insensitively
 * (mirrors the Ruby CLI's dual-keying). */
function headersToRecord(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((value, key) => {
    out[key] = value;
    out[key.toLowerCase()] = value;
  });
  return out;
}

const realGhcrHttp: GhcrHttp = {
  async get(url, headers) {
    const res = await fetch(url, { method: "GET", headers });
    return {
      status: res.status,
      headers: headersToRecord(res.headers),
      body: await res.text(),
    };
  },
  async head(url, headers) {
    const res = await fetch(url, { method: "HEAD", headers });
    return {
      status: res.status,
      headers: headersToRecord(res.headers),
      body: "",
    };
  },
};

/**
 * Mint the short-lived registry bearer via GHCR's /token exchange. When a
 * PAT is present we authenticate the exchange with Basic auth
 * (base64("x-access-token:<pat>")). Throws if a PAT was supplied but the
 * exchange failed — the caller must NOT silently downgrade to anonymous
 * (that conflates "no token" with "supplied token failed"). Returns
 * undefined only when NO PAT was supplied and the package is not
 * anonymously pullable.
 */
async function ghcrBearerFor(
  name: string,
  pat: string | undefined,
  http: GhcrHttp,
): Promise<string | undefined> {
  const url = `https://ghcr.io/token?service=ghcr.io&scope=repository:${GHCR_ORG}/${name}:pull`;
  const headers: Record<string, string> = {};
  if (pat) {
    headers.Authorization =
      "Basic " + Buffer.from(`x-access-token:${pat}`).toString("base64");
  }
  const resp = await http.get(url, headers);
  if (resp.status >= 400) {
    if (pat) {
      throw new Error(
        `GHCR /token exchange failed (${resp.status}) for ${GHCR_ORG}/${name}`,
      );
    }
    return undefined;
  }
  let parsed: { token?: string };
  try {
    parsed = JSON.parse(resp.body) as { token?: string };
  } catch (e) {
    throw new Error(
      `GHCR /token returned unparseable body for ${GHCR_ORG}/${name}: ${(e as Error).message}`,
      { cause: e },
    );
  }
  return parsed.token;
}

/**
 * Resolve `ghcr.io/copilotkit/<name>:<tag>` to its content digest
 * (`sha256:...`). Fail-loud: throws on a 404 (the tag does not exist),
 * on any other >=400, and on a missing Docker-Content-Digest header.
 * NEVER returns the bare tag as a fallback — that would reintroduce the
 * mutable-:latest-in-prod bug.
 */
export async function resolveGhcrDigest(
  name: string,
  tag = "latest",
  http: GhcrHttp = realGhcrHttp,
  pat: string | undefined = ghcrPat(),
): Promise<string> {
  const bearer = await ghcrBearerFor(name, pat, http);
  const url = `https://ghcr.io/v2/${GHCR_ORG}/${name}/manifests/${tag}`;
  const headers: Record<string, string> = { Accept: GHCR_ACCEPT_MANIFEST };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  const resp = await http.head(url, headers);
  if (resp.status === 404) {
    throw new Error(
      `GHCR manifest HEAD 404 for ghcr.io/${GHCR_ORG}/${name}:${tag} — the image tag does not exist; cannot pin prod to a digest. Build & push the image first.`,
    );
  }
  if (resp.status >= 400) {
    throw new Error(
      `GHCR manifest HEAD ${resp.status} for ghcr.io/${GHCR_ORG}/${name}:${tag}`,
    );
  }
  const digest =
    resp.headers["docker-content-digest"] ||
    resp.headers["Docker-Content-Digest"];
  if (!digest) {
    throw new Error(
      `GHCR did not return Docker-Content-Digest for ghcr.io/${GHCR_ORG}/${name}:${tag}`,
    );
  }
  return digest;
}

/**
 * Build the digest-pinned PROD image ref for a slug. Resolves the current
 * `:latest` digest for `showcase-<slug>` and returns
 * `ghcr.io/copilotkit/showcase-<slug>@sha256:<digest>`. Fail-loud: any
 * resolution failure propagates — prod is NEVER born on the bare tag.
 * Exported for unit testing against an injected resolver.
 */
export async function buildProdImageRef(
  slug: string,
  resolve: (name: string) => Promise<string> = (name) =>
    resolveGhcrDigest(name),
): Promise<string> {
  const repoName = `showcase-${slug}`;
  const digest = await resolve(repoName);
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) {
    throw new Error(
      `GHCR returned a malformed digest for ${repoName}: ${JSON.stringify(
        digest,
      )} — refusing to pin prod to a non-canonical digest.`,
    );
  }
  return `ghcr.io/${GHCR_ORG}/${repoName}@${digest}`;
}

async function railwayGql<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const token = getToken();
  const res = await fetch(RAILWAY_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Railway API error: ${res.status} ${text}`);
  }

  const json = (await res.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length) {
    throw new Error(
      `Railway GraphQL errors:\n${json.errors.map((e) => `  - ${e.message}`).join("\n")}`,
    );
  }
  return json.data as T;
}

// ── List services ──────────────────────────────────────────────────────

interface ProjectServices {
  project: {
    services: {
      edges: Array<{ node: { id: string; name: string } }>;
    };
  };
}

async function listServices(): Promise<void> {
  const data = await railwayGql<ProjectServices>(
    `query project($id: String!) {
            project(id: $id) {
                services {
                    edges { node { id name } }
                }
            }
        }`,
    { id: SHOWCASE.projectId },
  );

  const services = data.project.services.edges.map((e) => e.node);
  console.log("Showcase services on Railway:\n");
  for (const s of services) {
    console.log(`  ${s.name.padEnd(35)} ${s.id}`);
  }
}

// ── Find a service by name ─────────────────────────────────────────────

async function findService(name: string): Promise<{ id: string } | null> {
  const data = await railwayGql<ProjectServices>(
    `query project($id: String!) {
            project(id: $id) {
                services {
                    edges { node { id name } }
                }
            }
        }`,
    { id: SHOWCASE.projectId },
  );

  const match = data.project.services.edges.find((e) => e.node.name === name);
  return match ? { id: match.node.id } : null;
}

// ── Create service ─────────────────────────────────────────────────────

interface ServiceCreateResult {
  serviceCreate: { id: string; name: string };
}

interface ServiceDomainResult {
  serviceDomainCreate: { domain: string };
}

async function createService(slug: string): Promise<void> {
  const pkgDir = path.join(PACKAGES_DIR, slug);
  if (!fs.existsSync(pkgDir)) {
    console.error(`Package not found: ${pkgDir}`);
    process.exit(1);
  }

  const manifestPath = path.join(pkgDir, "manifest.yaml");
  if (!fs.existsSync(manifestPath)) {
    console.error(`No manifest.yaml in ${pkgDir}`);
    process.exit(1);
  }

  const serviceName = `showcase-${slug}`;

  // Check if already exists
  const existing = await findService(serviceName);
  if (existing) {
    console.log(`Service ${serviceName} already exists: ${existing.id}`);
    console.log(
      `Dashboard: https://railway.com/project/${SHOWCASE.projectId}/service/${existing.id}`,
    );
    return;
  }

  // This script provisions into the PRODUCTION environment
  // (SHOWCASE.environmentId === PRODUCTION_ENV_ID). The showcase contract is
  // "prod is PINNED to a digest; staging floats :latest." So resolve the
  // GHCR digest NOW and pin the source image — a prod service must be born
  // digest-pinned, never tracking the mutable `:latest` tag. Fail-loud: if
  // the digest can't be resolved, abort rather than silently provisioning
  // prod on `:latest` (the regression class that broke ms-agent-dotnet).
  // Staging provisioning lives elsewhere (provision-starter-fleet.ts) and is
  // intentionally NOT changed — staging floats by design.
  let imagePath: string;
  try {
    imagePath = await buildProdImageRef(slug);
  } catch (e) {
    console.error(
      `Failed to resolve a GHCR digest for showcase-${slug}: ${(e as Error).message}`,
    );
    console.error(
      "Prod services must be pinned to a content digest (@sha256:...), not the mutable :latest tag.",
    );
    console.error(
      "Ensure the image has been built & pushed to ghcr.io/copilotkit/showcase-" +
        slug +
        ":latest, and that GHCR_TOKEN or GITHUB_TOKEN (packages:read) is set, then re-run.",
    );
    process.exit(1);
  }

  console.log(`Creating Railway service: ${serviceName}`);
  console.log(`  Image (digest-pinned): ${imagePath}`);

  // 1. Create the service
  const createResult = await railwayGql<ServiceCreateResult>(
    `mutation serviceCreate($input: ServiceCreateInput!) {
            serviceCreate(input: $input) { id name }
        }`,
    {
      input: {
        projectId: SHOWCASE.projectId,
        name: serviceName,
        source: { image: imagePath },
      },
    },
  );

  const svcId = createResult.serviceCreate.id;
  console.log(`  Created service: ${svcId}`);

  // 2. Configure health check, region, and registry credentials
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    console.warn(
      "\n  WARNING: GITHUB_TOKEN not set. Registry credentials will not be configured.",
    );
    console.warn(
      "  Set GITHUB_TOKEN and re-run, or configure manually in the Railway dashboard.\n",
    );
  }

  // Resolve the healthcheck path from the SSOT (railway-envs.ts) so this
  // onboarding script does not become a SECOND untracked source of truth (the
  // failure mode behind the aimock silent-null incident). `serviceName` is the
  // canonical SSOT key (`showcase-<slug>`) and SHOWCASE.environmentId is
  // PRODUCTION_ENV_ID, so we resolve the prod value. The shared resolver
  // distinguishes a tracked-null service (omit the healthcheck) from an
  // untracked new service (agent-class `/api/health` default) — forcing
  // `/api/health` onto a tracked-null service 404s and wedges the deploy.
  const instanceInput: Record<string, unknown> = {
    region: "us-west1",
  };
  const hc = resolveProvisionHealthcheck(serviceName);
  if (hc.kind === "set") {
    instanceInput.healthcheckPath = hc.path;
  }
  if (githubToken) {
    // GHCR registry username: read from env (GHCR_USERNAME preferred, then
    // GITHUB_ACTOR for CI contexts). Fail loud rather than baking a
    // personal handle into the script.
    const ghcrUser = (
      process.env.GHCR_USERNAME ||
      process.env.GITHUB_ACTOR ||
      ""
    ).trim();
    if (!ghcrUser) {
      console.error(
        "GITHUB_TOKEN is set but no GHCR username is available. Set GHCR_USERNAME (or GITHUB_ACTOR in CI) to the username the token is issued to.",
      );
      process.exit(1);
    }
    instanceInput.registryCredentials = {
      username: ghcrUser,
      password: githubToken,
    };
  }

  await railwayGql(
    `mutation serviceInstanceUpdate($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
            serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
        }`,
    {
      serviceId: svcId,
      environmentId: SHOWCASE.environmentId,
      input: instanceInput,
    },
  );
  console.log(
    `  Configured health check, region${githubToken ? ", registry credentials" : ""}`,
  );

  // 3. Generate public domain
  const domainResult = await railwayGql<ServiceDomainResult>(
    `mutation serviceDomainCreate($input: ServiceDomainCreateInput!) {
            serviceDomainCreate(input: $input) { domain }
        }`,
    {
      input: {
        serviceId: svcId,
        environmentId: SHOWCASE.environmentId,
      },
    },
  );
  const domain = domainResult.serviceDomainCreate.domain;
  const publicUrl = `https://${domain}`;
  console.log(`  Public URL: ${publicUrl}`);

  // 4. Set NODE_ENV=production
  await railwayGql(
    `mutation variableCollectionUpsert($input: VariableCollectionUpsertInput!) {
            variableCollectionUpsert(input: $input)
        }`,
    {
      input: {
        projectId: SHOWCASE.projectId,
        environmentId: SHOWCASE.environmentId,
        serviceId: svcId,
        variables: { NODE_ENV: "production" },
      },
    },
  );
  console.log(`  Set NODE_ENV=production`);

  // 5. Update the CI workflow file with the service ID
  const workflowPath = path.resolve(
    ROOT,
    "..",
    ".github",
    "workflows",
    "showcase_deploy.yml",
  );
  if (fs.existsSync(workflowPath)) {
    let workflow = fs.readFileSync(workflowPath, "utf-8");
    const placeholder = new RegExp(
      `(showcase-${slug}.*?)RAILWAY_SERVICE_ID`,
      "s",
    );
    if (workflow.match(placeholder)) {
      workflow = workflow.replace(placeholder, `$1${svcId}`);
      fs.writeFileSync(workflowPath, workflow);
      console.log(`\n  Updated showcase_deploy.yml with service ID ${svcId}`);
    }
  }

  // 6. Update manifest.yaml backend_url with the actual domain
  const manifestRaw = fs.readFileSync(manifestPath, "utf-8");
  const manifest = yaml.parse(manifestRaw);
  if (!manifest.backend_url || manifest.backend_url.includes("PLACEHOLDER")) {
    const updated = manifestRaw.replace(
      /^backend_url:.*$/m,
      `backend_url: "${publicUrl}"`,
    );
    fs.writeFileSync(manifestPath, updated);
    console.log(`  Updated manifest.yaml backend_url to ${publicUrl}`);
  }

  console.log(`
Done! Next steps:
  1. Push an image: docker build & push to ghcr.io/copilotkit/showcase-${slug}:latest
     (or push code and let CI build it)
  2. Once healthy: npx tsx showcase/scripts/deploy-to-railway.ts --go-live ${slug}
  3. Commit the workflow + manifest changes and push
`);
}

// ── Go live ────────────────────────────────────────────────────────────

const PROD_DIGEST_SHAPE =
  /^ghcr\.io\/copilotkit\/[a-z0-9-]+@sha256:[0-9a-f]{64}$/;

interface ProdInstanceQuery {
  project: {
    services: {
      edges: Array<{
        node: {
          name: string;
          serviceInstances: {
            edges: Array<{
              node: {
                environmentId: string;
                source: { image: string | null } | null;
              };
            }>;
          };
        };
      }>;
    };
  };
}

/**
 * Injectable Railway query for the prod serviceInstance image. Mirrors the
 * `GhcrHttp` DI seam above: production passes the real `railwayGql`-backed
 * implementation, tests pass a fake returning a canned `ProdInstanceQuery`.
 * `projectId` is the Railway project to look the service up in.
 */
export type ProdInstanceQueryFn = (
  projectId: string,
) => Promise<ProdInstanceQuery>;

/** Default prod-instance query: hits Railway via the module-level gql client. */
const realProdInstanceQuery: ProdInstanceQueryFn = (projectId) =>
  railwayGql<ProdInstanceQuery>(
    `query project($id: String!) {
            project(id: $id) {
                services {
                    edges {
                        node {
                            name
                            serviceInstances {
                                edges { node { environmentId source { image } } }
                            }
                        }
                    }
                }
            }
        }`,
    { id: projectId },
  );

/**
 * Typed error thrown by `assertProdDigestPinned` when the prod image is
 * missing, unconfigured, or not digest-pinned. The CLI call site (`goLive`)
 * maps this onto the exit-1 contract — the guard itself stays
 * process.exit-free so it is unit-testable (mirrors `resolveRailwayToken` /
 * `getToken`, where exit mapping lives at the call site, not in the core).
 */
export class ProdPinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProdPinError";
  }
}

/**
 * Fail-loud guard: assert the PROD serviceInstance for `serviceName` has a
 * digest-pinned `source.image` (`@sha256:...`). THROWS a `ProdPinError` if
 * the service/instance is missing, has no image, or is still on the mutable
 * `:latest` tag — production behavior (exit 1) is preserved by the caller,
 * which catches and maps. Railway I/O is injected via `query` so the guard
 * is unit-testable without network access (mirrors the `GhcrHttp` seam).
 */
export async function assertProdDigestPinned(
  serviceName: string,
  environmentId: string = SHOWCASE.environmentId,
  query: ProdInstanceQueryFn = realProdInstanceQuery,
  projectId: string = SHOWCASE.projectId,
): Promise<void> {
  const data = await query(projectId);

  const svc = data.project.services.edges.find(
    (e) => e.node.name === serviceName,
  );
  if (!svc) {
    throw new ProdPinError(
      `Cannot verify prod image pin: service ${serviceName} not found in project ${projectId}.`,
    );
  }
  const instance = svc.node.serviceInstances.edges.find(
    (e) => e.node.environmentId === environmentId,
  );
  const image = instance?.node.source?.image ?? null;
  if (!image) {
    throw new ProdPinError(
      `Cannot go live: ${serviceName} has no production image source configured.`,
    );
  }
  if (!PROD_DIGEST_SHAPE.test(image)) {
    throw new ProdPinError(
      `Refusing to go live: ${serviceName} prod image is not digest-pinned (got: ${image}).\n` +
        "Prod must be pinned to ghcr.io/copilotkit/<repo>@sha256:<digest>, not the mutable :latest tag.\n" +
        `Run \`bin/railway promote ${serviceName.replace(/^showcase-/, "")}\` (or re-provision) to digest-pin prod, then retry --go-live.`,
    );
  }
  console.log(`  Prod image is digest-pinned: ${image}`);
}

async function goLive(slug: string): Promise<void> {
  const manifestPath = path.join(PACKAGES_DIR, slug, "manifest.yaml");
  if (!fs.existsSync(manifestPath)) {
    console.error(`No manifest.yaml for ${slug}`);
    process.exit(1);
  }

  // Read manifest for backend_url
  const manifest = yaml.parse(fs.readFileSync(manifestPath, "utf-8"));
  const backendUrl = manifest.backend_url;
  if (!backendUrl) {
    console.error(`No backend_url in manifest.yaml for ${slug}`);
    process.exit(1);
  }

  // Guard: prod must be digest-pinned before it goes live. createService now
  // pins at provisioning time, but a service created before this fix (or
  // edited by hand) could still be tracking the mutable `:latest` tag.
  // Going live on `:latest` is exactly the regression class this fix
  // closes, so refuse it loudly rather than lighting up an unpinned prod.
  // The guard throws a typed ProdPinError; map it onto the exit-1 contract
  // HERE so the guard itself stays process.exit-free and unit-testable.
  try {
    await assertProdDigestPinned(`showcase-${slug}`);
  } catch (e) {
    if (e instanceof ProdPinError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }

  // Health check — resolve the path from the SSOT (railway-envs.ts) via the
  // SAME shared resolver as createService so this does not become a SECOND
  // source of truth. A tracked-null service (dashboard, docs, dojo, webhooks,
  // pocketbase) has no HTTP health endpoint; probing `/api/health` would 404
  // and (via process.exit below) wedge the deploy — so SKIP the HTTP check
  // entirely for those.
  const ssotKey = `showcase-${slug}`;
  const hc = resolveProvisionHealthcheck(ssotKey);
  if (hc.kind === "omit") {
    console.log(
      `  Skipping HTTP health check — ${ssotKey} has no healthcheckPath in the SSOT (tracked-null service).`,
    );
  } else {
    const healthUrl = `${backendUrl}${hc.path}`;
    console.log(`Checking health: ${healthUrl}`);
    try {
      const res = await fetch(healthUrl, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        console.error(`Health check failed: ${res.status}`);
        process.exit(1);
      }
      console.log(`  Healthy!`);
    } catch (e: unknown) {
      console.error(`  Not reachable: ${(e as Error).message}`);
      process.exit(1);
    }
  }

  // Update manifest: deployed: true
  const raw = fs.readFileSync(manifestPath, "utf-8");
  const updated = raw.replace(/^deployed:\s*false$/m, "deployed: true");
  fs.writeFileSync(manifestPath, updated);
  console.log(`  Set deployed: true in manifest.yaml`);

  // Regenerate registry
  console.log(`  Regenerating registry...`);
  const { execSync } = await import("child_process");
  execSync("npx tsx showcase/scripts/generate-registry.ts", {
    cwd: path.resolve(ROOT, ".."),
    stdio: "inherit",
  });

  console.log(`\nDone! Commit and push to light up the stack chip.`);
}

// ── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help") {
    console.log(`Usage:
  npx tsx showcase/scripts/deploy-to-railway.ts <slug>            Create Railway service
  npx tsx showcase/scripts/deploy-to-railway.ts --list            List showcase services
  npx tsx showcase/scripts/deploy-to-railway.ts --go-live <slug>  Verify health + flip deployed
`);
    process.exit(0);
  }

  if (args[0] === "--list") {
    await listServices();
    return;
  }

  if (args[0] === "--go-live") {
    if (!args[1]) {
      console.error("Usage: --go-live <slug>");
      process.exit(1);
    }
    await goLive(args[1]);
    return;
  }

  await createService(args[0]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
