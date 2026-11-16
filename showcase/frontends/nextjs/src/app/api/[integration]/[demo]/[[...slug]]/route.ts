// The CopilotKit runtime of each demo: /api/<integration>/<demo> and the
// runtime paths under it. A demo page gets this URL from useDemoRuntimeUrl.
// The auth and voice demos have their own routes, which take precedence over
// this one.
import { loadIntegration } from "@/lib/agents";
import { createDemoRouteHandler } from "./runtime-handler";
import type { DemoTarget } from "./runtime-handler";

const handleDemoRequest = createDemoRouteHandler({ loadIntegration });

async function handle(
  request: Request,
  { params }: { params: Promise<DemoTarget> },
) {
  return handleDemoRequest(request, await params);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
