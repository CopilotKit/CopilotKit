/** Scheduled/manual collector; importing this module never performs an audit. */
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type * as AuditCollector from "../shell-dashboard/scripts/compatibility-audit/collect";
import type * as DeployedCollector from "../shell-dashboard/scripts/compatibility-audit/deployed";
import { resolveEnv, SERVICES } from "./railway-envs";
import { canonicalPayload, computeSignature } from "../harness/src/http/hmac";

const PATH = "/api/compatibility";

// The standalone dashboard's audit modules use CommonJS; this scripts package
// uses ESM. Load them through Node's existing CommonJS bridge under tsx.
const requireAudit = createRequire(import.meta.url);
const { collectAudit }: typeof AuditCollector = requireAudit(
  "../shell-dashboard/scripts/compatibility-audit/collect",
);
const { collectDeployedCommits }: typeof DeployedCollector = requireAudit(
  "../shell-dashboard/scripts/compatibility-audit/deployed",
);

async function publish(
  base: string,
  value: Record<string, unknown>,
): Promise<void> {
  const secret = process.env.SHARED_SECRET?.trim();
  if (!secret)
    throw new Error("SHARED_SECRET is required for compatibility publication");
  const body = JSON.stringify(value);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = computeSignature(
    secret,
    canonicalPayload("POST", PATH, timestamp, body),
  );
  const response = await fetch(base + PATH, {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      "X-Ops-Timestamp": timestamp,
      "X-Ops-Signature": `sha256=${signature}`,
    },
    body,
  });
  if (!response.ok)
    throw new Error(
      `Compatibility publication failed: HTTP ${response.status}`,
    );
}

export async function refreshCompatibility(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      environment: { type: "string" },
      out: { type: "string" },
      "no-publish": { type: "boolean" },
    },
  });
  if (values.environment !== "prod" && values.environment !== "staging")
    throw new Error("--environment must be prod or staging");
  if (!values.out) throw new Error("--out is required");
  const environment = values.environment;
  const { envId } = resolveEnv(environment);
  const domain = SERVICES.harness.environments[environment]?.domain;
  if (!domain) throw new Error(`Missing harness domain for ${environment}`);
  const base = `https://${domain}`;
  const attemptedAt = new Date().toISOString();
  const runUrl = process.env.GITHUB_RUN_ID
    ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : "https://github.com/CopilotKit/CopilotKit/actions";
  const common = { environmentId: envId, attemptedAt, runUrl };
  if (!values["no-publish"] && !process.env.SHARED_SECRET?.trim())
    throw new Error("SHARED_SECRET is required for compatibility publication");
  try {
    const sourceCommits = await collectDeployedCommits(environment);
    const result = await collectAudit({
      out: values.out,
      asOf: attemptedAt,
      sourceCommits,
    });
    if (!values["no-publish"])
      await publish(base, {
        ...common,
        status: "success",
        snapshot: result.snapshot,
        sourceCommits,
      });
    console.log(
      `Compatibility: ${environment}, ${result.snapshot.rows.length} variants assessed at ${attemptedAt}`,
    );
  } catch (error) {
    if (!values["no-publish"]) {
      try {
        await publish(base, {
          ...common,
          status: "failed",
          error: "Compatibility refresh failed. See the audit run for details.",
        });
      } catch (publicationError) {
        console.error(
          publicationError instanceof Error
            ? publicationError.message
            : "Failed to report audit failure",
        );
      }
    }
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  refreshCompatibility(process.argv.slice(2)).catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Compatibility refresh failed",
    );
    process.exitCode = 1;
  });
}
