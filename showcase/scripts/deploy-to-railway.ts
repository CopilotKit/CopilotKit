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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PACKAGES_DIR = path.join(ROOT, "integrations");

const RAILWAY_API = "https://backboard.railway.com/graphql/v2";

const SHOWCASE = {
  projectId: "6f8c6bff-a80d-4f8f-b78d-50b32bcf4479",
  environmentId: "b14919f4-6417-429f-848d-c6ae2201e04f",
};

function getToken(): string {
  if (process.env.RAILWAY_TOKEN) return process.env.RAILWAY_TOKEN;

  const configPath = path.join(
    process.env.HOME || "~",
    ".railway",
    "config.json",
  );
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (config?.user?.token) return config.user.token;
  }

  console.error(
    "No Railway token found. Set RAILWAY_TOKEN or run `railway login`.",
  );
  process.exit(1);
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
  const imagePath = `ghcr.io/copilotkit/showcase-${slug}:latest`;

  // Check if already exists
  const existing = await findService(serviceName);
  if (existing) {
    console.log(`Service ${serviceName} already exists: ${existing.id}`);
    console.log(
      `Dashboard: https://railway.com/project/${SHOWCASE.projectId}/service/${existing.id}`,
    );
    return;
  }

  console.log(`Creating Railway service: ${serviceName}`);
  console.log(`  Image: ${imagePath}`);

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

  const instanceInput: Record<string, unknown> = {
    healthcheckPath: "/api/health",
    region: "us-west1",
  };
  if (githubToken) {
    instanceInput.registryCredentials = {
      username: "jpr5",
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

  // Health check
  const healthUrl = `${backendUrl}/api/health`;
  console.log(`Checking health: ${healthUrl}`);
  try {
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      console.error(`Health check failed: ${res.status}`);
      process.exit(1);
    }
    console.log(`  Healthy!`);
  } catch (e: unknown) {
    console.error(`  Not reachable: ${(e as Error).message}`);
    process.exit(1);
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
