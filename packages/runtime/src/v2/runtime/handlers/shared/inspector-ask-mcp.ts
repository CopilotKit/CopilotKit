import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { IntelligenceAccessGrant } from "../../core/runtime";
import type { CopilotKitIntelligence } from "../../intelligence-platform/client";
import {
  encodeIntelligenceUserIdHeader,
  PlatformRequestError,
} from "../../intelligence-platform/client";

/** Opens the product MCP endpoint with request-scoped credentials and bounded responses. */
export async function openInspectorAnalytics(input: {
  readonly intelligence: CopilotKitIntelligence;
  readonly userId: string;
  readonly grant: IntelligenceAccessGrant;
  readonly signal: AbortSignal;
}): Promise<Client> {
  const url = new URL(`${input.intelligence.ɵgetApiUrl()}/mcp`);
  const grantHeader = JSON.stringify(input.grant).replace(
    /[^\x20-\x7e]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: {
      headers: {
        Authorization: `Bearer ${input.intelligence.ɵgetApiKey()}`,
        "x-cpki-user-id": encodeIntelligenceUserIdHeader(input.userId),
        "x-cpki-grant": grantHeader,
      },
    },
    fetch: async (target, init) => {
      const requested = new URL(target);
      if (requested.href !== url.href)
        throw new Error("Unexpected analytics endpoint");
      const response = await fetch(target, {
        ...init,
        redirect: "error",
        signal: init?.signal
          ? AbortSignal.any([input.signal, init.signal])
          : input.signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new PlatformRequestError(
          "Analytics unavailable",
          response.status,
          response.status >= 500,
        );
      }
      if (!response.body) return response;
      let bytes = 0;
      const body = response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            bytes += chunk.byteLength;
            if (bytes > 262_144)
              throw new Error("Analytics result is too large");
            controller.enqueue(chunk);
          },
        }),
      );
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    },
  });
  const client = new Client({ name: "copilotkit-inspector-ask", version: "1" });
  try {
    await client.connect(transport, { signal: input.signal });
    return client;
  } catch (error) {
    await client.close();
    throw error;
  }
}
