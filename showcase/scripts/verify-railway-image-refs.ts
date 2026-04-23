#!/usr/bin/env npx tsx
/**
 * verify-railway-image-refs.ts — Drift assertion for Railway showcase image refs.
 *
 * Fetches every service in the CopilotKit Showcase project and validates that
 * the configured Docker image reference matches the canonical GHCR form:
 *   ghcr.io/copilotkit/<service-name>:latest
 *
 * Backstory: on 2026-04-21, 18 production services were found with malformed
 * image refs of the form `ghcr.io/copilotkit/showcase-<slug>atest` (missing
 * the `:` before `latest`, so Docker treats `...atest` as the tag). The root
 * cause was an out-of-band MCP/manual mutation — no committed code touched
 * these refs. This script exists so any future corruption, regardless of
 * source, fails loudly and early in CI before a bad deploy goes out.
 *
 * Usage:
 *   npx tsx showcase/scripts/verify-railway-image-refs.ts
 *
 * Requires: RAILWAY_TOKEN env var or ~/.railway/config.json
 * Exit: 0 when every service matches the canonical shape, 1 on any violation.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const RAILWAY_API = "https://backboard.railway.com/graphql/v2";

const SHOWCASE = {
  projectId: "6f8c6bff-a80d-4f8f-b78d-50b32bcf4479",
  environmentId: "b14919f4-6417-429f-848d-c6ae2201e04f",
};

// Canonical shape: ghcr.io/copilotkit/<name>:latest where <name> is the
// service name itself. This single pattern covers showcase-<slug>,
// showcase-starter-<slug>, showcase-pocketbase, showcase-ops, and any
// future showcase-* service. Enforcing identity between Railway service
// name and image name (modulo the ghcr.io/copilotkit/ prefix and :latest
// tag) is the invariant — if these ever drift apart we want to know.
//
// The regex accepts both `showcase-*` and bare `<name>` images to
// accommodate services like aimock whose wrapper was eliminated — the
// Railway service is still named `showcase-aimock` but the image is now
// `ghcr.io/copilotkit/aimock:latest`.
const IMAGE_SHAPE = /^ghcr\.io\/copilotkit\/[a-z0-9-]+:latest$/;

// Services whose GHCR image name intentionally differs from the Railway
// service name. After the aimock wrapper elimination (PR #128), Railway
// pulls `ghcr.io/copilotkit/aimock:latest` directly instead of the old
// `showcase-aimock` wrapper image. The verify job must accept this
// divergence rather than requiring image === service name.
const IMAGE_OVERRIDES: Record<string, string> = {
  "showcase-aimock": "ghcr.io/copilotkit/aimock:latest",
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
    throw new Error(`Railway API error: ${res.status} ${await res.text()}`);
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

interface ProjectServicesWithInstances {
  project: {
    services: {
      edges: Array<{
        node: {
          id: string;
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

interface Violation {
  service: string;
  image: string | null;
  reason: string;
}

export function validateImage(
  serviceName: string,
  image: string | null,
): Violation | null {
  if (!image) {
    return {
      service: serviceName,
      image,
      reason:
        "no image source configured (expected a Docker image, not a repo)",
    };
  }
  if (!IMAGE_SHAPE.test(image)) {
    return {
      service: serviceName,
      image,
      reason: `does not match canonical shape ^ghcr\\.io/copilotkit/[a-z0-9-]+:latest$`,
    };
  }
  const expected =
    IMAGE_OVERRIDES[serviceName] ??
    `ghcr.io/copilotkit/${serviceName}:latest`;
  if (image !== expected) {
    return {
      service: serviceName,
      image,
      reason: `image name mismatches service name (expected exactly ${expected})`,
    };
  }
  return null;
}

async function main(): Promise<void> {
  const data = await railwayGql<ProjectServicesWithInstances>(
    `query project($id: String!) {
      project(id: $id) {
        services {
          edges { node {
            id
            name
            serviceInstances {
              edges { node { environmentId source { image } } }
            }
          } }
        }
      }
    }`,
    { id: SHOWCASE.projectId },
  );

  const services = data.project.services.edges
    .map((e) => e.node)
    .filter((s) => s.name.startsWith("showcase-"));

  const violations: Violation[] = [];
  let checked = 0;
  for (const svc of services) {
    const instance = svc.serviceInstances.edges.find(
      (e) => e.node.environmentId === SHOWCASE.environmentId,
    );
    const image = instance?.node.source?.image ?? null;
    checked++;
    const v = validateImage(svc.name, image);
    if (v) violations.push(v);
  }

  if (violations.length > 0) {
    console.error(
      `\n✗ Railway image-ref drift detected (${violations.length}/${checked} services)\n`,
    );
    console.error(
      `Expected shape: ghcr.io/copilotkit/<service-name>:latest` +
        ` (note the ':' before 'latest')\n`,
    );
    for (const v of violations) {
      console.error(`  ${v.service}`);
      console.error(`    current:  ${v.image ?? "<unset>"}`);
      console.error(`    expected: ghcr.io/copilotkit/${v.service}:latest`);
      console.error(`    reason:   ${v.reason}`);
    }
    console.error(
      `\nFix via Railway dashboard or the showcase deploy-to-railway script.` +
        ` A common past cause was ':' dropped from ':latest' by an out-of-band API mutation.\n`,
    );
    process.exit(1);
  }

  console.log(`✓ ${checked} services verified`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
