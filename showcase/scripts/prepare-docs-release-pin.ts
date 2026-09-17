#!/usr/bin/env npx tsx
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ENV_ID_BY_NAME, SERVICES } from "./railway-envs";
import { resolveRailwayToken } from "./lib/railway-token";
import { liveFetchDeployedDigest } from "./reconcile-staging";
import {
  DOCS_PROD_PIN_RELPATH,
  decideDocsReleasePin,
  parseDocsProdPin,
  serializeDocsProdPin,
} from "./docs-prod-pin";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function appendOutput(line: string): void {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return;
  writeFileSync(out, `${line}\n`, { flag: "a" });
}

async function resolveDigest(
  flag: string | undefined,
  env: "staging" | "prod",
): Promise<string | null> {
  if (flag !== undefined) {
    return flag.length === 0 ? null : flag;
  }
  const token = resolveRailwayToken();
  return liveFetchDeployedDigest(
    token,
    SERVICES.docs.serviceId,
    ENV_ID_BY_NAME[env],
  );
}

async function main(): Promise<void> {
  const pinPath = resolve(arg("pin-path") ?? DOCS_PROD_PIN_RELPATH);
  const gitSha = arg("git-sha") ?? process.env.GIT_SHA ?? "";
  const verifiedAt = arg("verified-at") ?? new Date().toISOString();
  if (gitSha.length === 0) {
    throw new Error("git-sha is required (--git-sha or GIT_SHA)");
  }

  const stagingDigest = await resolveDigest(arg("staging-digest"), "staging");
  const prodDigest = await resolveDigest(arg("prod-digest"), "prod");
  let pinOnMain = null;
  if (existsSync(pinPath)) {
    pinOnMain = parseDocsProdPin(readFileSync(pinPath, "utf8"));
  }

  const decision = decideDocsReleasePin({
    stagingDigest,
    prodDigest,
    pinOnMain,
    gitSha,
    verifiedAt,
  });

  if (decision.action === "skip") {
    appendOutput("skip=true");
    appendOutput(`reason=${decision.reason}`);
    console.log(decision.reason);
    return;
  }

  mkdirSync(dirname(pinPath), { recursive: true });
  writeFileSync(pinPath, serializeDocsProdPin(decision.pin));
  appendOutput("skip=false");
  appendOutput(`reason=${decision.reason}`);
  appendOutput(`digest=${decision.pin.digest}`);
  console.log(decision.reason);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
