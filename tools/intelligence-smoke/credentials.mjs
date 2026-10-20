import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";

const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

/** Mint disposable test credentials. The signing private key never leaves this function. */
export function createCredentials() {
  const random = () => randomBytes(32).toString("hex");
  const organizationId = `org_smoke_${randomUUID().replaceAll("-", "")}`;
  const keyId = `smoke-${randomUUID()}`;
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const payload = {
    version: 1,
    license_id: randomUUID(),
    key_id: keyId,
    telemetry_id: "public-smoke",
    purpose: "local_evaluation",
    owner: {
      org_id: organizationId,
      org_name: "Public smoke",
      contact_email: "smoke@example.invalid",
    },
    issued_at: new Date(Date.now() - 60_000).toISOString(),
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    tier: "free",
    seat_limit: 1,
    remove_branding: false,
    features: {
      self_learning: true,
      "threads.retention_hours": 72,
      "threads.max_count": 200,
      multimodal_storage_gb: 1,
      deployment_via_helm_chart: true,
    },
  };
  const body = `${encode({ alg: "EdDSA", typ: "LIC", kid: keyId })}.${encode(payload)}`;
  const apiKeyLong = random();
  return {
    organizationId,
    publicKeys: JSON.stringify({
      [keyId]: publicKey
        .export({ type: "spki", format: "der" })
        .toString("base64"),
    }),
    licenseToken: `${body}.${sign(null, Buffer.from(body), privateKey).toString("base64url")}`,
    apiKeyShort: randomBytes(8).toString("hex"),
    apiKeyLong,
    apiKeyHash: createHash("sha256").update(apiKeyLong).digest("hex"),
    serviceToken: random(),
    learningToken: random(),
    database: random(),
    databaseAdmin: random(),
    redis: random(),
    session: random(),
    oidcClient: random(),
    objectAccess: random(),
    objectSecret: random(),
    gatewayRunner: random(),
    gatewaySession: random(),
    beamCookie: random(),
    channelEncryption: random(),
  };
}
