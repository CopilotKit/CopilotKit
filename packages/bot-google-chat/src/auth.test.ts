import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const verifySignedJwtWithCertsAsync = vi.fn();
// Captures the options object the GoogleAuth constructor was last called with,
// so the credential-resolution tests can assert how credentials/keyFile/subject
// were derived from opts and env.
let lastGoogleAuthOptions: Record<string, unknown> | undefined;
vi.mock("google-auth-library", () => ({
  OAuth2Client: class { verifySignedJwtWithCertsAsync = verifySignedJwtWithCertsAsync; },
  GoogleAuth: class {
    constructor(options: Record<string, unknown>) {
      lastGoogleAuthOptions = options;
    }
  },
}));

import { createInboundVerifier, createTokenProvider, UnauthorizedError } from "./auth.js";

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

  it("does not burn the debounce window when the self-heal refetch itself fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    // Cold cache. First fetch (the initial getCerts) succeeds; the self-heal
    // refetch then FAILS (cert endpoint outage). Because the refetch failed,
    // lastRefetchAt must NOT advance — so a follow-up failure within the window
    // is still allowed to refetch.
    const fetchMock = vi
      .fn()
      // initial getCerts (cold cache) for the first verify
      .mockResolvedValueOnce({ ok: true, json: async () => CERTS } as unknown as Response)
      // self-heal refetch for the first verify → outage (clears the cache)
      .mockResolvedValueOnce({ ok: false, status: 503 } as unknown as Response)
      // getCerts for the second verify (cache was cleared by the failed refetch)
      .mockResolvedValueOnce({ ok: true, json: async () => CERTS } as unknown as Response)
      // self-heal refetch for the second verify → recovered
      .mockResolvedValueOnce({ ok: true, json: async () => CERTS } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const v = createInboundVerifier({ googleChatProjectNumber: "123" });

    // First verify: initial verify fails, self-heal refetch is attempted (window
    // is open) but the cert endpoint is down → CertFetchError propagates (→ 500,
    // NOT Unauthorized). Crucially, the failed refetch did not advance the window.
    verifySignedJwtWithCertsAsync.mockRejectedValueOnce(new Error("stale signing key"));
    await expect(v.verify("Bearer rotated.jwt.1")).rejects.not.toBeInstanceOf(UnauthorizedError);
    expect(fetchMock).toHaveBeenCalledTimes(2); // initial getCerts + failed refetch

    // Second verify a few seconds later (well within the 5-minute window) with a
    // now-valid token and a working refetch. Since the prior refetch FAILED and
    // did not burn the window, the self-heal refetch IS attempted again here.
    vi.setSystemTime(5_000);
    verifySignedJwtWithCertsAsync
      .mockRejectedValueOnce(new Error("stale signing key"))
      .mockResolvedValueOnce({
        getPayload: () => ({ aud: "123", iss: "chat@system.gserviceaccount.com" }),
      });
    await expect(v.verify("Bearer rotated.jwt.2")).resolves.toBeUndefined();
    // The 4th fetch is the recovered self-heal refetch — proof the window was
    // NOT burned by the earlier failed refetch. (The failed refetch cleared the
    // cache, so the second verify also re-runs the cold-cache getCerts: fetch #3
    // is that getCerts, fetch #4 is the self-heal refetch that was allowed
    // because the prior refetch failed without advancing lastRefetchAt.)
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("surfaces a cert-fetch failure as a non-UnauthorizedError (→ 500, not 401)", async () => {
    // Cold cache + the cert endpoint is down: obtaining the certs throws before
    // the token is ever verified. This is OUR infrastructure failing, not a bad
    // token, so verify() must reject with something OTHER than UnauthorizedError
    // (the request handler maps that to 500, letting Google Chat retry).
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503 }) as unknown as Response),
    );
    const v = createInboundVerifier({ googleChatProjectNumber: "123" });
    await expect(v.verify("Bearer some.jwt.token")).rejects.toThrow();
    await expect(v.verify("Bearer some.jwt.token")).rejects.not.toBeInstanceOf(UnauthorizedError);
    // The token is never even verified when the certs can't be fetched.
    expect(verifySignedJwtWithCertsAsync).not.toHaveBeenCalled();
  });

  it("bounds concurrent self-heal refetches to a single outbound cert fetch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => CERTS }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    const v = createInboundVerifier({ googleChatProjectNumber: "123" });

    // Warm the cert cache with one successful verify so the concurrent failures
    // below skip the initial getCerts() fetch — this isolates the SELF-HEAL
    // refetch count, which is what the in-flight guard bounds.
    verifySignedJwtWithCertsAsync.mockResolvedValueOnce({
      getPayload: () => ({ aud: "123", iss: "chat@system.gserviceaccount.com" }),
    });
    await expect(v.verify("Bearer good.jwt")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1); // the warm-up fetch
    fetchMock.mockClear();

    // Now every verification fails, so each concurrent request enters the
    // self-heal refetch path within the same debounce window.
    verifySignedJwtWithCertsAsync.mockRejectedValue(new Error("invalid signature"));

    // Fire 3 concurrent verifications. Without the in-flight guard each would
    // fire its own refetch (3 fetches); the guard collapses them onto ONE.
    const results = await Promise.allSettled([
      v.verify("Bearer bad.1"),
      v.verify("Bearer bad.2"),
      v.verify("Bearer bad.3"),
    ]);
    for (const r of results) {
      expect(r.status).toBe("rejected");
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(UnauthorizedError);
    }
    // Exactly one self-heal refetch across all three concurrent failures.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bypasses verification when disableSignatureVerification is set", async () => {
    const v = createInboundVerifier({ disableSignatureVerification: true });
    await expect(v.verify(undefined)).resolves.toBeUndefined();
    expect(verifySignedJwtWithCertsAsync).not.toHaveBeenCalled();
  });
});

describe("createTokenProvider credential resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastGoogleAuthOptions = undefined;
  });

  it("parses opts.credentials given as an inline-JSON string into a credentials object", () => {
    const json = '{"client_email":"svc@proj.iam.gserviceaccount.com","private_key":"k"}';
    createTokenProvider({ credentials: json });
    expect(lastGoogleAuthOptions?.credentials).toEqual({
      client_email: "svc@proj.iam.gserviceaccount.com",
      private_key: "k",
    });
    expect(lastGoogleAuthOptions).not.toHaveProperty("keyFile");
  });

  it("treats a non-JSON opts.credentials string as a key-file path", () => {
    createTokenProvider({ credentials: "/secrets/key.json" });
    expect(lastGoogleAuthOptions?.keyFile).toBe("/secrets/key.json");
    expect(lastGoogleAuthOptions).not.toHaveProperty("credentials");
  });

  it("passes an opts.credentials object straight through as credentials", () => {
    const obj = { client_email: "svc@proj.iam.gserviceaccount.com", private_key: "k" };
    createTokenProvider({ credentials: obj });
    expect(lastGoogleAuthOptions?.credentials).toEqual(obj);
    expect(lastGoogleAuthOptions).not.toHaveProperty("keyFile");
  });

  it("honors GOOGLE_CHAT_CREDENTIALS as a key-file path when opts.credentials is unset", () => {
    const prev = process.env.GOOGLE_CHAT_CREDENTIALS;
    process.env.GOOGLE_CHAT_CREDENTIALS = "/env/secrets/key.json";
    try {
      createTokenProvider({});
      expect(lastGoogleAuthOptions?.keyFile).toBe("/env/secrets/key.json");
      expect(lastGoogleAuthOptions).not.toHaveProperty("credentials");
    } finally {
      if (prev === undefined) delete process.env.GOOGLE_CHAT_CREDENTIALS;
      else process.env.GOOGLE_CHAT_CREDENTIALS = prev;
    }
  });

  it("sets the DWD subject and scopes when impersonateUser is provided", () => {
    createTokenProvider({
      credentials: { client_email: "svc@proj.iam.gserviceaccount.com", private_key: "k" },
      impersonateUser: "user@example.com",
    });
    expect(
      (lastGoogleAuthOptions?.clientOptions as { subject?: string } | undefined)?.subject,
    ).toBe("user@example.com");
    const scopes = lastGoogleAuthOptions?.scopes as string[];
    expect(scopes).toContain("https://www.googleapis.com/auth/chat.bot");
    expect(scopes).toContain("https://www.googleapis.com/auth/chat.spaces");
    expect(scopes).toContain("https://www.googleapis.com/auth/chat.messages");
  });
});
