import { describe, expect, it, vi } from "vitest";
import { EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { firstValueFrom, of, Subject, throwError, toArray } from "rxjs";
import {
  isCodeChartRequest,
  streamCodeThenChart,
} from "../lib/code-chart-flow";

const input: RunAgentInput = {
  threadId: "thread",
  runId: "run",
  state: {},
  context: [],
  forwardedProps: {},
  messages: [
    {
      id: "user",
      role: "user",
      content:
        "Please write a linear regression in python, and then show me a chart breaking down the keywords you used.",
    },
  ],
  tools: [{ name: "showDemoChart", description: "Chart", parameters: {} }],
};
const start = { type: EventType.RUN_STARTED, threadId: "thread", runId: "run" };
const finish = {
  type: EventType.RUN_FINISHED,
  threadId: "thread",
  runId: "run",
};
const code = "```python\ndef fit(x):\n    return x\n```";
const codeEvents: BaseEvent[] = [
  start,
  { type: EventType.TEXT_MESSAGE_START, messageId: "code", role: "assistant" },
  { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "code", delta: code },
  { type: EventType.TEXT_MESSAGE_END, messageId: "code" },
  finish,
];

describe("code and chart demo flow", () => {
  it("only selects the requested demo with an available chart tool", () => {
    expect(isCodeChartRequest(input)).toBe(true);
    expect(isCodeChartRequest({ ...input, tools: [] })).toBe(false);
    expect(
      isCodeChartRequest({
        ...input,
        messages: [{ id: "u", role: "user", content: "Show me a chart" }],
      }),
    ).toBe(false);
    expect(
      isCodeChartRequest({
        ...input,
        messages: [
          ...input.messages,
          { id: "t", role: "tool", toolCallId: "tool", content: "done" },
        ],
      }),
    ).toBe(false);
  });

  it("streams code before the chart and supplies that code to the second call", async () => {
    const write = vi.fn((_input: RunAgentInput) => of(...codeEvents));
    const chart = vi.fn((_input: RunAgentInput) =>
      of(
        start,
        {
          type: EventType.TOOL_CALL_START,
          toolCallId: "chart",
          toolCallName: "showDemoChart",
        },
        finish,
      ),
    );
    const events = await firstValueFrom(
      streamCodeThenChart(input, write, chart).pipe(toArray()),
    );
    expect(write.mock.calls[0]?.[0]).toMatchObject({ tools: [] });
    expect(chart.mock.calls[0]?.[0]).toMatchObject({
      messages: [
        ...input.messages,
        { id: "code", role: "assistant", content: code },
      ],
    });
    expect(events.filter((e) => e.type === EventType.RUN_STARTED)).toHaveLength(
      1,
    );
    expect(
      events.filter((e) => e.type === EventType.RUN_FINISHED),
    ).toHaveLength(1);
    expect(
      events.findIndex((e) => e.type === EventType.TEXT_MESSAGE_END),
    ).toBeLessThan(
      events.findIndex((e) => e.type === EventType.TOOL_CALL_START),
    );
  });

  it("does not call the chart after a code-generation error", async () => {
    const chart = vi.fn();
    const error = { type: EventType.RUN_ERROR, message: "failed" };
    const events = await firstValueFrom(
      streamCodeThenChart(input, () => of(start, error), chart).pipe(toArray()),
    );
    expect(events.at(-1)).toEqual(error);
    expect(chart).not.toHaveBeenCalled();
  });

  it("captures BuiltInAgent text chunks before generating the chart", async () => {
    const chart = vi.fn((_input: RunAgentInput) => of(start, finish));
    await firstValueFrom(
      streamCodeThenChart(
        input,
        () =>
          of(
            start,
            {
              type: EventType.TEXT_MESSAGE_CHUNK,
              messageId: "code",
              role: "assistant",
              delta: code,
            },
            finish,
          ),
        chart,
      ).pipe(toArray()),
    );
    expect(chart.mock.calls[0]?.[0].messages.at(-1)).toMatchObject({
      content: code,
    });
  });

  it("rejects missing code instead of charting fabricated data", async () => {
    const chart = vi.fn();
    await expect(
      firstValueFrom(
        streamCodeThenChart(input, () => of(start, finish), chart).pipe(
          toArray(),
        ),
      ),
    ).rejects.toThrow("complete Python code block");
    expect(chart).not.toHaveBeenCalled();
  });

  it("propagates chart errors", async () => {
    await expect(
      firstValueFrom(
        streamCodeThenChart(
          input,
          () => of(...codeEvents),
          () => throwError(() => new Error("chart failed")),
        ).pipe(toArray()),
      ),
    ).rejects.toThrow("chart failed");
  });

  it("preserves usage from both model calls on the final run event", async () => {
    const firstUsage = { model: "test", inputTokens: 10, outputTokens: 20 };
    const secondUsage = { model: "test", inputTokens: 30, outputTokens: 5 };
    const events = await firstValueFrom(
      streamCodeThenChart<BaseEvent>(
        input,
        () =>
          of(...codeEvents.slice(0, -1), { ...finish, usage: [firstUsage] }),
        () => of(start, { ...finish, usage: [secondUsage] }),
      ).pipe(toArray()),
    );
    expect(events.at(-1)).toMatchObject({ usage: [firstUsage, secondUsage] });
  });

  it("cancels before starting the chart when unsubscribed during code generation", () => {
    const codeStream = new Subject<BaseEvent>();
    const chart = vi.fn();
    const subscription = streamCodeThenChart(
      input,
      () => codeStream,
      chart,
    ).subscribe();
    subscription.unsubscribe();
    codeStream.complete();
    expect(chart).not.toHaveBeenCalled();
    expect(codeStream.observed).toBe(false);
  });
});
