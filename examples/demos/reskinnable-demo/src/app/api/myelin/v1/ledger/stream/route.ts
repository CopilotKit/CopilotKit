import * as store from "@/skins/myelin/data/store";

/**
 * The ledger as a server-sent event stream: one snapshot on connect, then a new
 * one whenever anything changes (a write bumps `version`; presence changes are
 * compared too). This is how every open window — and the agent's writes from
 * the ADK process — show up live.
 *
 * Why a stream and not the poll it replaced: while an agent run is streaming,
 * the chat holds several long-lived HTTP/1.1 requests to this same origin, and
 * the browser's per-host connection cap queued the short poll requests behind
 * them — so the journey only appeared once the run ENDED, which defeats the
 * whole "watch it build" beat. One persistent connection, opened at page load,
 * keeps its slot for the whole session.
 */
export const dynamic = "force-dynamic";

const TICK_MS = 300;
const KEEPALIVE_MS = 15_000;

function fingerprint(): string {
  const s = store.snapshot();
  return `${s.version}|${s.presence
    .map((p) => `${p.adminId}:${p.page}:${p.journeyId}`)
    .sort()
    .join(",")}`;
}

export async function GET(req: Request) {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let keepalive: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let last = "";
      const send = () => {
        const fp = fingerprint();
        if (fp === last) return;
        last = fp;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(store.snapshot())}\n\n`),
        );
      };
      const close = () => {
        clearInterval(timer);
        clearInterval(keepalive);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      send();
      timer = setInterval(() => {
        try {
          send();
        } catch {
          close();
        }
      }, TICK_MS);
      keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          close();
        }
      }, KEEPALIVE_MS);
      req.signal.addEventListener("abort", close);
    },
    cancel() {
      clearInterval(timer);
      clearInterval(keepalive);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
