import { generateKeyPairSync, sign } from "node:crypto";

/** An RSA key pair that signs OIDC tokens like Google does, with its JWKS. */
export const signer = (() => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = {
    ...publicKey.export({ format: "jwk" }),
    kid: "k1",
    alg: "RS256",
    use: "sig",
  };
  return {
    jwks: { keys: [jwk] },
    token(claims: Record<string, unknown>, kid = "k1"): string {
      const enc = (v: unknown) =>
        Buffer.from(JSON.stringify(v)).toString("base64url");
      const head = enc({ alg: "RS256", kid, typ: "JWT" });
      const body = enc(claims);
      const sig = sign(
        "RSA-SHA256",
        Buffer.from(`${head}.${body}`),
        privateKey,
      );
      return `${head}.${body}.${sig.toString("base64url")}`;
    },
  };
})();
