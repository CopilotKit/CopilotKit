export const DOCS_GHCR_IMAGE = "ghcr.io/copilotkit/showcase-shell-docs";
export const DOCS_STAGING_URL = "https://docs.staging.copilotkit.ai";
export const DOCS_PROD_PIN_RELPATH = "showcase/pins/docs-prod.json";

const DIGEST_RE = /^sha256:[a-f0-9]{64}$/i;

export type DocsProdPin = {
  schema_version: 1;
  service: "docs";
  image: string;
  digest: string;
  git_sha: string;
  staging_url: string;
  verified_at: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseDocsProdPin(raw: string): DocsProdPin {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("docs prod pin is not valid JSON");
  }
  if (!isRecord(parsed)) {
    throw new Error("docs prod pin must be an object");
  }
  if (parsed.schema_version !== 1) {
    throw new Error(
      `docs prod pin schema_version must be 1, got ${String(parsed.schema_version)}`,
    );
  }
  if (parsed.service !== "docs") {
    throw new Error(
      `docs prod pin service must be "docs", got ${String(parsed.service)}`,
    );
  }
  if (typeof parsed.digest !== "string" || !DIGEST_RE.test(parsed.digest)) {
    throw new Error(
      `docs prod pin digest must be sha256:<64 hex>, got ${String(parsed.digest)}`,
    );
  }
  const expectedImage = `${DOCS_GHCR_IMAGE}@${parsed.digest}`;
  if (parsed.image !== expectedImage) {
    throw new Error(
      `docs prod pin image must be ${expectedImage}, got ${String(parsed.image)}`,
    );
  }
  if (typeof parsed.git_sha !== "string" || parsed.git_sha.length === 0) {
    throw new Error("docs prod pin git_sha is missing");
  }
  if (
    typeof parsed.staging_url !== "string" ||
    parsed.staging_url.length === 0
  ) {
    throw new Error("docs prod pin staging_url is missing");
  }
  if (
    typeof parsed.verified_at !== "string" ||
    parsed.verified_at.length === 0
  ) {
    throw new Error("docs prod pin verified_at is missing");
  }
  return {
    schema_version: 1,
    service: "docs",
    image: parsed.image,
    digest: parsed.digest,
    git_sha: parsed.git_sha,
    staging_url: parsed.staging_url,
    verified_at: parsed.verified_at,
  };
}

export function serializeDocsProdPin(pin: DocsProdPin): string {
  return `${JSON.stringify(pin, null, 2)}\n`;
}

export type DecideDocsReleasePinInput = {
  stagingDigest: string | null;
  prodDigest: string | null;
  pinOnMain: DocsProdPin | null;
  gitSha: string;
  verifiedAt: string;
};

export type DecideDocsReleasePinResult =
  | { action: "skip"; reason: string }
  | { action: "write"; reason: string; pin: DocsProdPin };

export function decideDocsReleasePin(
  input: DecideDocsReleasePinInput,
): DecideDocsReleasePinResult {
  if (input.stagingDigest === null) {
    return { action: "skip", reason: "staging digest is missing" };
  }
  if (input.stagingDigest === input.prodDigest) {
    return { action: "skip", reason: "staging digest equals prod digest" };
  }
  if (input.pinOnMain?.digest === input.stagingDigest) {
    return { action: "skip", reason: "staging digest equals pin on main" };
  }
  return {
    action: "write",
    reason: "staging digest differs from prod and pin",
    pin: {
      schema_version: 1,
      service: "docs",
      image: `${DOCS_GHCR_IMAGE}@${input.stagingDigest}`,
      digest: input.stagingDigest,
      git_sha: input.gitSha,
      staging_url: DOCS_STAGING_URL,
      verified_at: input.verifiedAt,
    },
  };
}
