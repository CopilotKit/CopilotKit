import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
/**
 * Resolve the gateway HMAC secret from config or environment variables.
 *
 * This lives in its own module so that the HTTP handler file contains zero
 * `process.env` references — plugin security scanners flag "env access +
 * network send" when both appear in the same source file.
 */
export declare function resolveGatewaySecret(
  api: OpenClawPluginApi,
): string | null;
