import { describe, it, expect, vi, beforeEach } from "vitest";

const verifySignedJwtWithCertsAsync = vi.fn();
vi.mock("google-auth-library", () => ({
  OAuth2Client: class { verifySignedJwtWithCertsAsync = verifySignedJwtWithCertsAsync; },
  GoogleAuth: class {},
}));

import { createInboundVerifier, UnauthorizedError } from "./auth.js";

const CERTS = { kid1: "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----" };

function stubCertFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => CERTS }) as unknown as Response),
  );
}

describe("createInboundVerifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubCertFetch();
  });

  it("rejects a missing Authorization header", async () => {
    const v = createInboundVerifier({ googleChatProjectNumber: "123" });
    await expect(v.verify(undefined)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(verifySignedJwtWithCertsAsync).not.toHaveBeenCalled();
  });

  it("accepts a token that verifies against the Chat x509 certs", async () => {
    verifySignedJwtWithCertsAsync.mockResolvedValueOnce({
      getPayload: () => ({ aud: "123", iss: "chat@system.gserviceaccount.com" }),
    });
    const v = createInboundVerifier({ googleChatProjectNumber: "123" });
    await expect(v.verify("Bearer good.jwt.token")).resolves.toBeUndefined();
    expect(verifySignedJwtWithCertsAsync).toHaveBeenCalledWith(
      "good.jwt.token",
      CERTS,
      "123",
      ["chat@system.gserviceaccount.com"],
    );
  });

  it("rejects a token whose signature/audience/issuer fails verification on both attempts", async () => {
    verifySignedJwtWithCertsAsync.mockRejectedValue(new Error("invalid signature"));
    const v = createInboundVerifier({ googleChatProjectNumber: "123" });
    await expect(v.verify("Bearer bad.jwt")).rejects.toBeInstanceOf(UnauthorizedError);
    // Initial verify + one self-heal refetch+retry.
    expect(verifySignedJwtWithCertsAsync).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("self-heals on stale certs: refetches and retries once when first verify throws", async () => {
    verifySignedJwtWithCertsAsync
      .mockRejectedValueOnce(new Error("stale signing key"))
      .mockResolvedValueOnce({
        getPayload: () => ({ aud: "123", iss: "chat@system.gserviceaccount.com" }),
      });
    const v = createInboundVerifier({ googleChatProjectNumber: "123" });
    await expect(v.verify("Bearer rotated.jwt")).resolves.toBeUndefined();
    expect(verifySignedJwtWithCertsAsync).toHaveBeenCalledTimes(2);
    // Initial fetch (empty cache) + one refetch after the cache is cleared.
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("bypasses verification when disableSignatureVerification is set", async () => {
    const v = createInboundVerifier({ disableSignatureVerification: true });
    await expect(v.verify(undefined)).resolves.toBeUndefined();
    expect(verifySignedJwtWithCertsAsync).not.toHaveBeenCalled();
  });
});
