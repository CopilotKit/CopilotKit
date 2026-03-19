import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import * as crypto from "crypto";
import { CopilotKitProvider, useCopilotKit } from "../CopilotKitProvider";
import { LICENSE_PUBLIC_KEYS } from "@copilotkit/shared";

const TEST_KEY_ID = "test-license-kid";
let testPublicKey: string;
let testPrivateKey: string;

function base64UrlEncode(data: Buffer | string): string {
  const buffer = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function makeToken(overrides: Record<string, any> = {}): string {
  const payload = {
    version: 1,
    license_id: "lic-test",
    key_id: TEST_KEY_ID,
    owner: { org_id: "org", org_name: "Test", contact_email: "t@t.com" },
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
    tier: "enterprise",
    seat_limit: 10,
    features: { chat: true, sidebar: true, agents: true },
    remove_branding: true,
    ...overrides,
  };
  const header = { alg: "EdDSA", typ: "LIC", kid: TEST_KEY_ID };
  const h = base64UrlEncode(JSON.stringify(header));
  const p = base64UrlEncode(JSON.stringify(payload));
  const pem =
    "-----BEGIN PRIVATE KEY-----\n" +
    testPrivateKey.match(/.{1,64}/g)!.join("\n") +
    "\n-----END PRIVATE KEY-----";
  const sig = crypto.sign(
    null,
    Buffer.from(`${h}.${p}`),
    crypto.createPrivateKey(pem),
  );
  return `${h}.${p}.${base64UrlEncode(sig)}`;
}

beforeAll(() => {
  const kp = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  testPublicKey = Buffer.from(kp.publicKey).toString("base64");
  testPrivateKey = Buffer.from(kp.privateKey).toString("base64");
  // LICENSE_PUBLIC_KEYS is a mutable exported object from the license-verifier keystore
  LICENSE_PUBLIC_KEYS[TEST_KEY_ID] = testPublicKey;
});

describe("CopilotKitProvider license", () => {
  it("renders without warnings when valid licenseToken provided", () => {
    const token = makeToken();
    const { container } = render(
      <CopilotKitProvider runtimeUrl="/api" licenseToken={token}>
        <div>child</div>
      </CopilotKitProvider>,
    );
    expect(screen.queryByText(/Powered by CopilotKit/)).toBeNull();
    expect(screen.queryByText(/expired/i)).toBeNull();
  });

  it("shows expired banner when license is expired past grace", () => {
    const token = makeToken({
      expires_at: new Date(Date.now() - 10 * 86400000).toISOString(),
    });
    render(
      <CopilotKitProvider runtimeUrl="/api" licenseToken={token}>
        <div>child</div>
      </CopilotKitProvider>,
    );
    expect(screen.getByText(/expired/i)).toBeTruthy();
  });

  it("shows invalid banner when token has bad signature", () => {
    render(
      <CopilotKitProvider runtimeUrl="/api" licenseToken="bad.token.value">
        <div>child</div>
      </CopilotKitProvider>,
    );
    // parse_error or invalid — should show critical warning
    expect(
      screen.getByText(/Invalid CopilotKit license token/i),
    ).toBeTruthy();
  });
});
