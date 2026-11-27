import { bookChannelDemo } from "@/lib/early-access/demo-proxy";

// Books a demo time from an early-access channel page's booker:
// `POST /api/channel-demo/book`. See src/lib/early-access/demo-proxy.ts.
export function POST(request: Request) {
  return bookChannelDemo(request);
}
