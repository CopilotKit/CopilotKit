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
});
