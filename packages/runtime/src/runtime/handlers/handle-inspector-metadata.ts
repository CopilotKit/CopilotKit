import { parseInspectorMetadataV1 } from "@copilotkit/shared";
import type { CopilotRuntimeLike } from "../core/runtime";
import { isIntelligenceRuntime } from "../core/runtime";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "no-store, private",
} as const;

interface HandleInspectorMetadataParameters {
  runtime: CopilotRuntimeLike;
  request: Request;
}

function emptyInspectorMetadataResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}

/**
 * Returns trusted, sanitized Inspector metadata without exposing provider
 * failures or forwarding any browser request credentials to Intelligence.
 */
export async function handleInspectorMetadata({
  runtime,
}: HandleInspectorMetadataParameters): Promise<Response> {
  if (!isIntelligenceRuntime(runtime)) {
    return emptyInspectorMetadataResponse();
  }

  try {
    const metadata = parseInspectorMetadataV1(
      await runtime.intelligence.getInspectorMetadata(),
    );
    if (metadata === undefined) {
      return emptyInspectorMetadataResponse();
    }

    return new Response(JSON.stringify(metadata), {
      status: 200,
      headers: {
        ...PRIVATE_NO_STORE_HEADERS,
        "Content-Type": "application/json",
      },
    });
  } catch {
    return emptyInspectorMetadataResponse();
  }
}
