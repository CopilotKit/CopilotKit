import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
export declare function parseDataUri(value: string): {
  data: string;
  mimeType: string;
} | null;
export declare function createAguiHttpHandler(
  api: OpenClawPluginApi,
): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
/**
 * Factory for the operator-auth AG-UI route.
 *
 * Mounted at a separate path (e.g. `/v1/ag-ui/operator`) with
 * `auth: "gateway"` — the OpenClaw gateway validates the caller's operator
 * scopes before we see the request, so we skip the device-pairing dance. The
 * AG-UI dispatch logic itself is identical to the device-token path.
 *
 * Intended for operator-UI-embedded consumers (plugin-contributed UI slots)
 * that already hold an OpenClaw gateway token via `ExtensionTabContext` and
 * should not need a second pairing flow.
 */
export declare function createOperatorAguiHttpHandler(
  api: OpenClawPluginApi,
): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
