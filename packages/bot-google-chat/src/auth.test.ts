import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

  afterEach(() => {
    vi.useRealTimers();
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

  it("debounces refetch: two failures within the window trigger only one cert refetch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    // Every verification attempt fails (e.g. a flood of forged tokens).
    verifySignedJwtWithCertsAsync.mockRejectedValue(new Error("invalid signature"));
    const v = createInboundVerifier({ googleChatProjectNumber: "123" });

    // First bad token: initial verify fails, the self-heal refetch is allowed
    // (no prior refetch in the window), retried, fails again.
    await expect(v.verify("Bearer bad.jwt.1")).rejects.toBeInstanceOf(UnauthorizedError);
    // Initial fetch (cold cache) + one self-heal refetch.
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(verifySignedJwtWithCertsAsync).toHaveBeenCalledTimes(2);

    // Second bad token a few seconds later (well within the 5-minute window):
    // the initial verify fails again, but the refetch is debounced — no second
    // refetch happens, so we fail fast with no extra outbound fetch.
    vi.setSystemTime(5_000);
    await expect(v.verify("Bearer bad.jwt.2")).rejects.toBeInstanceOf(UnauthorizedError);
    // Still 2 fetches total — the second failure did NOT refetch.
    expect(fetch).toHaveBeenCalledTimes(2);
    // One more verify attempt (the second token's single initial attempt, no retry).
    expect(verifySignedJwtWithCertsAsync).toHaveBeenCalledTimes(3);
  });

  it("allows a fresh refetch once the debounce window has elapsed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    verifySignedJwtWithCertsAsync.mockRejectedValue(new Error("invalid signature"));
    const v = createInboundVerifier({ googleChatProjectNumber: "123" });

    await expect(v.verify("Bearer bad.jwt.1")).rejects.toBeInstanceOf(UnauthorizedError);
    expect(fetch).toHaveBeenCalledTimes(2);

    // Advance past the 5-minute window: a new failure is allowed to refetch
    // again (so genuine key rotation continues to self-heal).
    vi.setSystemTime(5 * 60_000 + 1);
    await expect(v.verify("Bearer bad.jwt.2")).rejects.toBeInstanceOf(UnauthorizedError);
    // Window elapsed → one more self-heal refetch is allowed.
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("bypasses verification when disableSignatureVerification is set", async () => {
    const v = createInboundVerifier({ disableSignatureVerification: true });
    await expect(v.verify(undefined)).resolves.toBeUndefined();
    expect(verifySignedJwtWithCertsAsync).not.toHaveBeenCalled();
  });
});
