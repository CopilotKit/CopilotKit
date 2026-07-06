#!/usr/bin/env node
/**
 * mint-dev-license — DEV-ONLY helper for the SELF-HOSTED Intelligence stack.
 *
 * Prints (or writes to .env) the two env values that unlock the paid `memory`
 * feature on a *locally-built* self-hosted Intelligence stack:
 *
 *   COPILOTKIT_LICENSE_TOKEN=<signed enterprise dev license, features.memory=true>
 *   BAKED_LICENSE_KEYS_JSON={"<keyId>":"<publicKey>"}
 *
 * WHY THIS EXISTS (and when you do NOT need it)
 * --------------------------------------------
 * Self-hosted Intelligence gates memory behind a signed offline license. A
 * *locally-built* (unbaked) app-api reads BAKED_LICENSE_KEYS_JSON live at
 * runtime, so a throwaway keypair whose public half is baked in can sign a
 * license the verifier trusts — no master-key attestation needed. See
 * packages/license-verifier/src/keystore.ts in the Intelligence repo.
 *
 * This does NOT work against — and is NOT needed for — MANAGED Intelligence or
 * the official public GHCR images: those bake CopilotKit's master public key as
 * the immutable root of trust and ignore a runtime BAKED_LICENSE_KEYS_JSON. For
 * the managed path you set a CopilotKit-ISSUED COPILOTKIT_LICENSE_TOKEN and OMIT
 * BAKED_LICENSE_KEYS_JSON entirely (see .env.example). This script is purely a
 * local-dev convenience and is never imported by the app runtime, so it does not
 * couple the demo to the self-hosted stack.
 *
 * The signer lives in the private Intelligence source (it depends on the
 * @cpki/license-catalog workspace package), so this wrapper drives that repo's
 * own toolchain rather than vendoring any signing code into this public repo.
 * Point INTELLIGENCE_REPO at your Intelligence checkout (defaults to the sibling
 * path the docker-compose image build also uses).
 *
 * USAGE
 *   node scripts/mint-dev-license.mjs            # print the two env lines
 *   node scripts/mint-dev-license.mjs --write    # upsert them into ./.env
 *   INTELLIGENCE_REPO=/path/to/Intelligence node scripts/mint-dev-license.mjs
 *   node scripts/mint-dev-license.mjs --org my-org   # override the license org
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEMO_ROOT = resolve(SCRIPT_DIR, "..");

// Match the docker-compose image build default: ${INTELLIGENCE_REPO:-../../../../Intelligence}
const DEFAULT_INTELLIGENCE_REPO = resolve(
  DEMO_ROOT,
  "../../../../Intelligence",
);
const INTELLIGENCE_REPO = process.env.INTELLIGENCE_REPO
  ? resolve(process.env.INTELLIGENCE_REPO)
  : DEFAULT_INTELLIGENCE_REPO;

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const orgFlagIdx = args.indexOf("--org");
const ORG_ID = orgFlagIdx !== -1 ? args[orgFlagIdx + 1] : "casa-de-erlang";

function die(msg) {
  console.error(`\n✗ mint-dev-license: ${msg}\n`);
  process.exit(1);
}

// --- Preflight: the private signer source + the repo's tsx must be present ---
const signerEntry = resolve(
  INTELLIGENCE_REPO,
  "libs/license-signing/src/index.ts",
);
if (!existsSync(signerEntry)) {
  die(
    `Intelligence signer not found at ${signerEntry}.\n` +
      `  This dev-license path needs the private Intelligence source. Set INTELLIGENCE_REPO\n` +
      `  to your Intelligence checkout, e.g.  INTELLIGENCE_REPO=/path/to/Intelligence\n` +
      `  NOT needed for MANAGED Intelligence — use a CopilotKit-issued license instead\n` +
      `  (see .env.example).`,
  );
}
const tsxBin = resolve(INTELLIGENCE_REPO, "node_modules/.bin/tsx");
if (!existsSync(tsxBin)) {
  die(
    `tsx not found at ${tsxBin}. Run 'pnpm install' in the Intelligence repo first.`,
  );
}

// --- Mint: run a throwaway signer inside the Intelligence repo context ---
// The signer imports @cpki/license-catalog via that repo's tsconfig paths, so
// the temp file must live inside the repo tree (relative import + repo cwd).
const repoTmpDir = resolve(INTELLIGENCE_REPO, "tmp");
mkdirSync(repoTmpDir, { recursive: true });
const tmpSigner = resolve(
  repoTmpDir,
  `_mint-banking-license.${process.pid}.ts`,
);

const signerSource = `
import { generateKeyPair, generateKeyId, createLicensePayload, signLicense, getDefaultFeatures } from '../libs/license-signing/src/index.ts';
const kp = generateKeyPair();
const keyId = generateKeyId();
const payload = createLicensePayload(
  { organizationId: ${JSON.stringify(ORG_ID)}, organizationName: 'banking-demo', contactEmail: 'demo@northwind.example',
    tier: 'enterprise', planCode: 'enterprise', entitlementSource: 'enterprise_override', issuer: 'banking-demo-local',
    seatLimit: 0, features: { ...getDefaultFeatures('enterprise'), memory: true }, removeBranding: true,
    expiresAt: new Date('2099-01-01T00:00:00Z'), telemetryId: 'banking-demo-local' },
  keyId, 'lic_banking_demo_local',
);
console.log('TOKEN=' + signLicense(payload, kp.privateKey));
console.log('BAKED=' + JSON.stringify({ [keyId]: kp.publicKey }));
`;

let out;
try {
  writeFileSync(tmpSigner, signerSource);
  out = execFileSync(tsxBin, [tmpSigner], {
    cwd: INTELLIGENCE_REPO,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
} catch (err) {
  die(
    `signing failed inside ${INTELLIGENCE_REPO}. See the error above.\n  ${err?.message ?? err}`,
  );
} finally {
  rmSync(tmpSigner, { force: true });
}

const token = out.match(/^TOKEN=(.+)$/m)?.[1];
const baked = out.match(/^BAKED=(.+)$/m)?.[1];
if (!token || !baked) die(`could not parse signer output:\n${out}`);

const envPairs = {
  // main renamed the deployment-mode env and uses the underscore value.
  INTELLIGENCE_DEPLOYMENT_MODE: "self_hosted",
  COPILOTKIT_LICENSE_TOKEN: token,
  BAKED_LICENSE_KEYS_JSON: baked,
};

if (!WRITE) {
  console.log(
    `# Self-hosted dev license (org: ${ORG_ID}). Paste into .env, or re-run with --write.`,
  );
  for (const [k, v] of Object.entries(envPairs)) console.log(`${k}=${v}`);
  console.log(
    `\n# MANAGED Intelligence does NOT use BAKED_LICENSE_KEYS_JSON — see .env.example.`,
  );
  process.exit(0);
}

// --- --write: upsert the keys into ./.env, preserving everything else ---
const envPath = resolve(DEMO_ROOT, ".env");
let envText = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
for (const [k, v] of Object.entries(envPairs)) {
  const line = `${k}=${v}`;
  const re = new RegExp(`^${k}=.*$`, "m");
  if (re.test(envText)) {
    envText = envText.replace(re, line);
  } else {
    if (envText.length && !envText.endsWith("\n")) envText += "\n";
    envText += `${line}\n`;
  }
}
writeFileSync(envPath, envText);
console.log(
  `✓ Wrote INTELLIGENCE_DEPLOYMENT_MODE, COPILOTKIT_LICENSE_TOKEN, BAKED_LICENSE_KEYS_JSON to ${envPath}`,
);
console.log(
  `  (org: ${ORG_ID}; self-hosted dev license, features.memory=true)`,
);
