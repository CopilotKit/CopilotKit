import { describe, it, expect, vi, beforeEach } from "vitest";

const verifyIdToken = vi.fn();
vi.mock("google-auth-library", () => ({
  OAuth2Client: class { verifyIdToken = verifyIdToken; },
  GoogleAuth: class {},
}));

import { createInboundVerifier, UnauthorizedError } from "./auth.js";

describe("createInboundVerifier", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("rejects a missing Authorization header", async () => {
    const v = createInboundVerifier({ googleChatProjectNumber: "123" });
    await expect(v.verify(undefined)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("accepts a token whose aud and issuer match", async () => {
    verifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({ aud: "123", iss: "chat@system.gserviceaccount.com" }),
    });
    const v = createInboundVerifier({ googleChatProjectNumber: "123" });
    await expect(v.verify("Bearer good.jwt.token")).resolves.toBeUndefined();
  });

  it("rejects a token with the wrong issuer", async () => {
    verifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({ aud: "123", iss: "evil@example.com" }),
    });
    const v = createInboundVerifier({ googleChatProjectNumber: "123" });
    await expect(v.verify("Bearer bad.jwt")).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("bypasses verification when disableSignatureVerification is set", async () => {
    const v = createInboundVerifier({ disableSignatureVerification: true });
    await expect(v.verify(undefined)).resolves.toBeUndefined();
    expect(verifyIdToken).not.toHaveBeenCalled();
  });
});
