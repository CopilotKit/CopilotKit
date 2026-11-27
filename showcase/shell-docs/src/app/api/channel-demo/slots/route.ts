import { getChannelDemoTimes } from "@/lib/early-access/demo-proxy";

// The open demo times for an early-access channel page's booker:
// `GET /api/channel-demo/slots?channel=<id>`. See src/lib/early-access/demo-proxy.ts.
export function GET(request: Request) {
  return getChannelDemoTimes(request);
}
