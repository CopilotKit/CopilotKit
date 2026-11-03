import { expect, test, vi } from "vitest";

import { recordAnnotation } from "../record-annotation";

test("recordAnnotation uses the caller's Runtime fetch", async () => {
  const runtimeFetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: "annotation-1", duplicate: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );

  const result = await recordAnnotation({
    runtimeUrl: "https://runtime.example.com/api/copilotkit",
    headers: { Authorization: "Bearer browser-token" },
    type: "user_action",
    payload: { title: "Renamed project" },
    threadId: "thread-1",
    clientEventId: "event-1",
    fetch: runtimeFetch,
  });

  expect(result).toEqual({ id: "annotation-1", duplicate: false });
  expect(runtimeFetch).toHaveBeenCalledWith(
    "https://runtime.example.com/api/copilotkit/annotate",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        type: "user_action",
        threadId: "thread-1",
        clientEventId: "event-1",
        payload: { title: "Renamed project" },
      }),
    }),
  );
});
