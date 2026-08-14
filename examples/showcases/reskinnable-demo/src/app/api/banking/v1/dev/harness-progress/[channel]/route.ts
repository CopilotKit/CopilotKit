import {
  readProgress,
  subscribeProgress,
} from "@/skins/banking/harness/progress";
import type { HarnessProgressEvent } from "@/skins/banking/harness/types";

/**
 * ARM A ONLY. Tails one harness channel as SSE.
 *
 * SSE rather than polling because the thing under comparison is whether thinking
 * arrives AS IT HAPPENS; a 1s poll would flatten exactly that and make Arm A
 * look worse than it is.
 *
 * Under `dev/` alongside `dev/reset` because it is presenter/diagnostic surface,
 * not banking ledger API. Deliberately NOT gated by `presenterResetEnabled()`:
 * it only reads progress, mutates nothing, and gating it would make the beat
 * invisible on exactly the hosted deploys we demo from.
 */

const frame = (event: HarnessProgressEvent): string =>
  `data: ${JSON.stringify(event)}\n\n`;

const isTerminal = (event: HarnessProgressEvent): boolean =>
  event.kind === "done" || event.kind === "error";

export const GET = async (
  _request: Request,
  { params }: { params: Promise<{ channel: string }> },
): Promise<Response> => {
  const { channel } = await params;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        controller.close();
      };

      const send = (event: HarnessProgressEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(frame(event)));
        if (isTerminal(event)) close();
      };

      // Subscribe BEFORE replaying the backlog so a frame published between the
      // two is delivered by the listener rather than lost in the gap.
      const unsubscribe = subscribeProgress(channel, send);
      for (const event of readProgress(channel)) send(event);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    },
  });
};
