// The auth demo's runtime: /api/<integration>/auth and the runtime paths
// under it. The agents come from createRuntimeConfig("auth"), and every
// request must carry `Authorization: DEMO_AUTH_HEADER`.
import {
  DEMO_AUTH_HOOKS,
  createDemoRouteHandler,
} from "@/app/api/[integration]/[demo]/[[...slug]]/runtime-handler";
import { loadIntegration } from "@/lib/agents";

const handleAuthRequest = createDemoRouteHandler({
  loadIntegration,
  hooks: DEMO_AUTH_HOOKS,
});

async function handle(
  request: Request,
  { params }: { params: Promise<{ integration: string }> },
) {
  const { integration } = await params;
  return handleAuthRequest(request, { integration, demo: "auth" });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
