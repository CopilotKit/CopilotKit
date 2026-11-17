// The voice demo's runtime: /api/<integration>/voice and the runtime paths
// under it, POST /transcribe included. The agents come from
// createRuntimeConfig("voice"), and the runtime transcribes with OpenAI unless
// the integration's options bring their own transcription service.
import {
  VOICE_RUNTIME_OPTIONS,
  createDemoRouteHandler,
} from "@/app/api/[integration]/[demo]/[[...slug]]/runtime-handler";
import { loadIntegration } from "@/lib/agents";

const handleVoiceRequest = createDemoRouteHandler({
  loadIntegration,
  runtimeOptions: VOICE_RUNTIME_OPTIONS,
});

async function handle(
  request: Request,
  { params }: { params: Promise<{ integration: string }> },
) {
  const { integration } = await params;
  return handleVoiceRequest(request, { integration, demo: "voice" });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
