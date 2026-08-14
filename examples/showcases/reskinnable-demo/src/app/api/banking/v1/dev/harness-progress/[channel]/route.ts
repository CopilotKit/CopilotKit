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

  // Hoisted out of `start` so `cancel` can reach it.
  let unsubscribe: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        controller.close();
      };

      const send = (event: HarnessProgressEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(frame(event)));
        if (isTerminal(event)) close();
      };

      // Subscribe BEFORE replaying the backlog so a frame published between the
      // two is delivered by the listener rather than lost in the gap. There must
      // be no `await` between these two statements — `start` running
      // synchronously is what makes the ordering unviolatable.
      unsubscribe = subscribeProgress(channel, send);
      for (const event of readProgress(channel)) send(event);
    },

    /**
     * The client went away mid-run — the presenter reloading the tab, which is
     * the very scenario this feature demonstrates. Without this the listener
     * stays in the channel and its `controller.enqueue` throws on the next
     * frame; `publishProgress` is defensive about that, but leaving a dead
     * listener to be discovered by a throw is not a design.
     */
    cancel() {
      unsubscribe?.();
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
