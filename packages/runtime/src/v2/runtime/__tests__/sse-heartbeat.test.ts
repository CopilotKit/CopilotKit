import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Observable, Subject } from "rxjs";
import { type BaseEvent, EventType } from "@ag-ui/client";
vi.mock("../telemetry", () => ({ telemetry: { capture: vi.fn() } }));
import { createSseEventResponse } from "../handlers/shared/sse-response";

const decoder = new TextDecoder();
const setup = () => {
  const controller = new AbortController();
  const events = new Subject<BaseEvent>();
  const response = createSseEventResponse({
    request: new Request("http://localhost/run", {signal: controller.signal}),
    observableFactory: () => events,
  });
  const reader = response.body!.getReader();
  return {controller, events, reader};
};

describe("SSE transport liveness", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps a quiet run alive with comments and preserves event order", async () => {
    const {events, reader} = setup();
    const first = reader.read();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(decoder.decode((await first).value)).toBe(": keep-alive\n\n");
    events.next({type: EventType.RUN_STARTED, threadId:"t", runId:"r"});
    expect(decoder.decode((await reader.read()).value)).toContain('"type":"RUN_STARTED"');
    events.complete();
    expect((await reader.read()).done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not queue heartbeats behind a slow reader", async () => {
    const {events, reader} = setup();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(decoder.decode((await reader.read()).value)).toBe(": keep-alive\n\n");
    events.complete();
    expect((await reader.read()).done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops the producer and timer when the request is aborted", async () => {
    const {controller, events, reader} = setup();
    await Promise.resolve();
    const read = reader.read();
    const outcome = expect(read).rejects.toMatchObject({name:"AbortError"});
    controller.abort();
    await outcome;
    expect(events.observed).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops the producer and timer when the response reader cancels", async () => {
    const {events, reader} = setup();
    await Promise.resolve();
    await reader.cancel("client disconnected");
    await Promise.resolve();
    expect(events.observed).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("unsubscribes a factory that resolves after the response was cancelled", async () => {
    let resolve!: (value: Observable<BaseEvent>) => void;
    const pending = new Promise<Observable<BaseEvent>>(r => {resolve=r;});
    const teardown = vi.fn();
    const response = createSseEventResponse({
      request:new Request("http://localhost/run"),
      observableFactory: () => pending,
    });
    await response.body!.cancel();
    resolve(new Observable(() => teardown));
    await vi.advanceTimersByTimeAsync(0);
    expect(teardown).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
