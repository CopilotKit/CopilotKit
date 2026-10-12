import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { remoteCommand, serviceReady } from "./inspection.mjs";

import { bootstrapInput } from "./bootstrap-audit.mjs";

export const bootstrapSource = Object.freeze({
  sourceRevision: "f1d326e8e6924da8186cf1d3d23277cc8bda80de",
  sha256: "a8c8256ec56a24cb2e494bd8309f6db0fb2ac70c473de1cee2f46e784dbf28b4",
});

export function validateBootstrap(config) {
  if (!config.bootstrap) return;
  const b = config.bootstrap;
  bootstrapInput(config);
  assert.equal(b.sourceRevision, bootstrapSource.sourceRevision);
  assert.equal(b.sha256, bootstrapSource.sha256);
  assert.ok(typeof b.scriptPath === "string" && b.scriptPath.startsWith("/"));
  const database = config.services.findIndex((s) => s.key === b.serviceKey);
  const after = config.services.findIndex((s) => s.key === b.afterServiceKey);
  assert.ok(
    database >= 0 && after > database,
    "Bootstrap requires ready database and composite",
  );
  assert.ok(config.services[database].roles.includes("database"));
  assert.ok(config.services[after].roles.includes("intelligence-api"));
  assert.ok(config.services[database].env?.DATABASE_URL);
  assert.ok(config.services[database].env?.BOOTSTRAP_CONFIG_B64);
  let databaseUrl;
  try {
    databaseUrl = new URL(config.services[database].env.DATABASE_URL);
  } catch {
    throw new Error("Bootstrap requires a local PostgreSQL URL");
  }
  assert.ok(
    ["postgres:", "postgresql:"].includes(databaseUrl.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(databaseUrl.hostname) &&
      (!databaseUrl.port || databaseUrl.port === "5432") &&
      !databaseUrl.search &&
      !databaseUrl.hash,
    "Bootstrap must target PostgreSQL inside the owned database service",
  );
  assert.ok(
    config.services.every(
      (s, index) =>
        !s.roles.some((role) =>
          ["application", "application-runtime", "native-backend"].includes(
            role,
          ),
        ) || index > after,
    ),
    "Bootstrap must precede applications and native backends",
  );
}

export function bindBootstrap(value, identity) {
  if (typeof value === "string")
    return value.replace(/\{\{bootstrap:([a-zA-Z]+)\}\}/g, (_match, key) => {
      assert.ok(
        ["projectId", "organizationId"].includes(key) && identity?.[key],
        "Unresolved bootstrap binding",
      );
      return identity[key];
    });
  if (Array.isArray(value)) return value.map((v) => bindBootstrap(v, identity));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, bindBootstrap(v, identity)]),
    );
  return value;
}

export async function runBootstrap({
  config,
  journal,
  service,
  execute = remoteCommand,
  readScript = readFile,
}) {
  const source = await readScript(config.bootstrap.scriptPath, "utf8");
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    bootstrapSource.sha256,
    "Bootstrap source digest mismatch",
  );
  assert.ok(
    await serviceReady({ journal, service, execute }),
    "Bootstrap database is not ready",
  );
  let stdout;
  try {
    stdout = await execute({
      journal,
      service,
      command: ["bash", "-c", source],
    });
  } catch {
    throw new Error("Owned canonical bootstrap failed");
  }
  const identity = parseBootstrapIdentity(stdout);
  const org = bootstrapInput(config).organizations[0];
  assert.ok(
    identity.organizationId ===
      (org.id || `org_${org.slug.replace(/[^a-z0-9]+/g, "_")}`),
    "Bootstrap returned another organization",
  );
  return identity;
}

export function parseBootstrapIdentity(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("CPKI_LOCAL_BOOTSTRAP="));
  assert.equal(lines.length, 1, "Bootstrap identity missing or ambiguous");
  let identity;
  try {
    identity = JSON.parse(lines[0].slice("CPKI_LOCAL_BOOTSTRAP=".length));
  } catch {
    throw new Error("Invalid bootstrap identity");
  }
  assert.ok(identity.version === 1, "Invalid bootstrap identity version");
  assert.ok(
    typeof identity.projectId === "string" &&
      /^[1-9][0-9]*$/.test(identity.projectId),
    "Invalid bootstrap project ID",
  );
  assert.ok(
    typeof identity.organizationId === "string" &&
      /^org_[a-z0-9_]+$/.test(identity.organizationId),
    "Invalid bootstrap organization ID",
  );
  return {
    ...bootstrapSource,
    projectId: identity.projectId,
    organizationId: identity.organizationId,
  };
}
