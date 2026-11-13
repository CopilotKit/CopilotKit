import test from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, verify, createHash } from "node:crypto";
import { createCredentials } from "./credentials.mjs";

test("ephemeral license verifies with its generated key and admits local Learning", () => {
  const credentials = createCredentials();
  const [header, payload, signature] = credentials.licenseToken.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url"));
  const keyId = JSON.parse(Buffer.from(header, "base64url")).kid;
  const publicKey = createPublicKey({
    key: Buffer.from(JSON.parse(credentials.publicKeys)[keyId], "base64"),
    type: "spki",
    format: "der",
  });
  assert.equal(
    verify(
      null,
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature, "base64url"),
    ),
    true,
  );
  assert.equal(claims.owner.org_id, credentials.organizationId);
  assert.equal(claims.purpose, "local_evaluation");
  assert.equal(claims.features.self_learning, true);
  assert.ok(claims.features["threads.retention_hours"] > 0);
  assert.ok(Date.parse(claims.expires_at) > Date.now());
  assert.equal(
    credentials.apiKeyHash,
    createHash("sha256").update(credentials.apiKeyLong).digest("hex"),
  );
  assert.match(credentials.serviceToken, /^[a-f0-9]{64}$/);
  assert.notEqual(createCredentials().serviceToken, credentials.serviceToken);
  assert.equal("privateKey" in credentials, false);
});
