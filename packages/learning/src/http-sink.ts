import type { LearningBatch, LearningSink, SinkSendOptions } from "./types";

/**
 * A sink that POSTs each batch as JSON to `url`.
 *
 * Uses `fetch` with `keepalive`. When the page is going away it uses
 * `navigator.sendBeacon`, which cannot send custom headers. There is no retry:
 * a failed send rejects, and the collector counts those events as dropped.
 *
 * @example createCollector({ sink: httpSink("/api/learning-events") })
 */
export function httpSink(
  url: string,
  init: { headers?: Record<string, string> } = {},
) {
  const send = async (batch: LearningBatch, options: SinkSendOptions = {}) => {
    const body = JSON.stringify(batch);
    const canBeacon =
      options.beacon === true && typeof navigator.sendBeacon === "function";
    if (canBeacon) {
      const queued = navigator.sendBeacon(
        url,
        new Blob([body], { type: "application/json" }),
      );
      if (!queued) throw new Error("sendBeacon refused the batch");
      return;
    }
    const response = await fetch(url, {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json", ...init.headers },
      body,
    });
    if (!response.ok) throw new Error(`Sink responded with ${response.status}`);
  };
  const sink: LearningSink = Object.assign(send, { url });
  return sink;
}
