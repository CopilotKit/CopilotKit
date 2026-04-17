import { describe, it, expect, vi } from "vitest";
import { invokeRender } from "../index";

describe("hook adapters", () => {
  it("action adapter invokes render with args/status/result", () => {
    const render = vi.fn(() => "ok");
    const config = { name: "a", render, handler: vi.fn() };
    const out = invokeRender("action", config, {
      args: { x: 1 },
      status: "complete",
      result: "done",
      onRespond: vi.fn(),
    });
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "a",
        args: { x: 1 },
        status: "complete",
        result: "done",
      }),
    );
    expect(out).toBe("ok");
  });

  it("action adapter omits result when status is not complete", () => {
    const render = vi.fn();
    invokeRender(
      "action",
      { name: "a", render },
      {
        args: {},
        status: "executing",
        result: "done",
        onRespond: vi.fn(),
      },
    );
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({ result: undefined, status: "executing" }),
    );
  });

  it("coagent-state adapter invokes render with state/status/nodeName", () => {
    const render = vi.fn();
    invokeRender(
      "coagent-state",
      { render },
      {
        state: { foo: 1 },
        status: "executing",
        nodeName: "n",
      },
    );
    expect(render).toHaveBeenCalledWith({
      state: { foo: 1 },
      status: "executing",
      nodeName: "n",
    });
  });

  it("interrupt adapter builds event from value", () => {
    const render = vi.fn();
    const resolve = vi.fn();
    invokeRender(
      "interrupt",
      { render },
      { eventValue: { q: "?" }, resolve, result: undefined },
    );
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({
        event: { value: { q: "?" } },
        resolve,
        result: undefined,
      }),
    );
  });

  it("render-tool adapter maps args to parameters and threads toolCallId", () => {
    const render = vi.fn();
    invokeRender(
      "render-tool",
      { name: "greet", render },
      {
        args: { who: "world" },
        status: "complete",
        result: "hi",
        onRespond: vi.fn(),
        toolCallId: "call-123",
      },
    );
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "greet",
        toolCallId: "call-123",
        parameters: { who: "world" },
        status: "complete",
        result: "hi",
      }),
    );
  });

  it("human-in-the-loop adapter invokes render with the same shape as action", () => {
    const render = vi.fn();
    const onRespond = vi.fn();
    invokeRender(
      "human-in-the-loop",
      { name: "confirm", render, handler: undefined },
      {
        args: { ok: true },
        status: "executing",
        result: "",
        onRespond,
      },
    );
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "confirm",
        args: { ok: true },
        status: "executing",
        result: undefined,
        respond: onRespond,
      }),
    );
  });

  it("custom-messages adapter forwards the message directly", () => {
    const render = vi.fn();
    const message = { id: "m1", role: "assistant", content: "hello" };
    invokeRender("custom-messages", { render }, { message });
    expect(render).toHaveBeenCalledWith(message);
  });

  it("activity-message adapter forwards the message directly", () => {
    const render = vi.fn();
    const message = { id: "a1", role: "system", content: "…" };
    invokeRender("activity-message", { render }, { message });
    expect(render).toHaveBeenCalledWith(message);
  });

  it("returns undefined when a config has no render function (safely no-ops)", () => {
    const out = invokeRender(
      "action",
      { name: "no-render" },
      { args: {}, status: "complete", result: "", onRespond: vi.fn() },
    );
    expect(out).toBeUndefined();
  });
});
