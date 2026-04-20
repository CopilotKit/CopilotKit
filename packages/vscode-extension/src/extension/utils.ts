import { randomBytes } from "node:crypto";

/**
 * Returns a cryptographically strong 32-char base62 nonce, suitable for
 * gating inline-script execution in webview CSP headers. Uses
 * `crypto.randomBytes` — `Math.random()` is predictable and not acceptable
 * for a value that decides whether arbitrary `<script>` content runs.
 */
export function getNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(32);
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(bytes[i] % chars.length);
  }
  return text;
}
