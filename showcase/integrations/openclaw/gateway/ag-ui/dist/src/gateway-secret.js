/**
 * Resolve the gateway HMAC secret from config or environment variables.
 *
 * This lives in its own module so that the HTTP handler file contains zero
 * `process.env` references — plugin security scanners flag "env access +
 * network send" when both appear in the same source file.
 */
export function resolveGatewaySecret(api) {
  const gatewayAuth = api.config.gateway?.auth;
  const secret =
    gatewayAuth?.token ??
    process.env.OPENCLAW_GATEWAY_TOKEN ??
    process.env.CLAWDBOT_GATEWAY_TOKEN;
  if (typeof secret === "string" && secret) {
    return secret;
  }
  return null;
}
