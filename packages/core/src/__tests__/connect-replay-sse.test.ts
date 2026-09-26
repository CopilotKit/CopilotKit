import { describe, expect, it } from "vitest";
import { runHttpRequest, EventType } from "@ag-ui/client";
import {
  CONNECTION_REPLAY_STARTED,
  CONNECTION_REPLAY_FINISHED,
} from "@copilotkit/shared";
import { lastValueFrom, tap, toArray } from "rxjs";
import { ɵtransformConnectStream } from "../utils/connect-replay-sse";

const encoder = new TextEncoder();

async function decode(chunks: Uint8Array[]) {
  const order: unknown[] = [];
  const response = new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
  await lastValueFrom(
    ɵtransformConnectStream(
      runHttpRequest(async () => response),
      {
        onReplayStarted: () => order.push("started"),
        onReplayFinished: () => order.push("finished"),
      },
    ).pipe(
      tap((event) => order.push(event)),
      toArray(),
    ),
  );
  return order;
}

describe("replay SSE controls", () => {
  it("preserves AG-UI decoding of a final data frame without a blank delimiter", async () => {
    const event = { type: EventType.RUN_ERROR, message: "Historical failure" };
    expect(
      await decode([encoder.encode(`data: ${JSON.stringify(event)}`)]),
    ).toEqual([event]);
  });

  it.each(["\n", "\r\n", "\r"])(
    "preserves ordering and UTF-8 with %j line endings at every byte boundary",
    async (newline) => {
      const historical = {
        type: EventType.RUN_ERROR,
        message: "Historical שלום",
      };
      const live = { type: EventType.RUN_ERROR, message: "Live failure" };
      const custom = {
        type: EventType.CUSTOM,
        name: CONNECTION_REPLAY_FINISHED,
        value: null,
      };
      const wire = [
        `event: ${CONNECTION_REPLAY_STARTED}`,
        "data: {}",
        "",
        `data: ${JSON.stringify(historical)}`,
        "",
        ": keep-alive",
        "",
        `data: ${JSON.stringify(custom)}`,
        "",
        `event: ${CONNECTION_REPLAY_FINISHED}`,
        "data: {}",
        "",
        `data: ${JSON.stringify(live)}`,
        "",
        "",
      ].join(newline);
      const bytes = encoder.encode(wire);
      const expected = ["started", historical, custom, "finished", live];
      expect(await decode([bytes])).toEqual(expected);
      for (let split = 1; split < bytes.length; split++) {
        expect(
          await decode([bytes.slice(0, split), bytes.slice(split)]),
        ).toEqual(expected);
      }
      expect(
        await decode(Array.from(bytes, (byte) => Uint8Array.of(byte))),
      ).toEqual(expected);
    },
  );
});
