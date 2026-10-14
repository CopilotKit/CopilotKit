import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { FrontendTool } from "@copilotkit/core";
import { createGenerativeUIDispatcher } from "../dispatcher";

const origin = { surfaceId: "s1", componentId: "c1" };

function setup({
  functions = {},
  tools = [],
  isToolEnabled,
}: {
  functions?: Record<string, any>;
  tools?: FrontendTool<any>[];
  isToolEnabled?: (name: string) => boolean;
} = {}) {
  const onError = vi.fn();
  const dispatcher = createGenerativeUIDispatcher({
    getProviderFunctions: () => functions,
    getTool: (name) => tools.find((t) => t.name === name),
    listTools: () => tools,
    isToolEnabled,
    onError,
  });
  return { dispatcher, onError };
}

describe("createGenerativeUIDispatcher", () => {
  it("runs a provider function with validated args and returns its result", async () => {
    const handler = vi.fn((args: { productId: string; quantity: number }) => ({
      added: args.quantity,
    }));
    const { dispatcher } = setup({
      functions: {
        addToCart: {
          parameters: z.object({
            productId: z.string(),
            quantity: z.number().default(1),
          }),
          handler,
        },
      },
    });
    const result = await dispatcher.invoke(
      "addToCart",
      { productId: "p1" },
      origin,
    );
    expect(result).toEqual({ ok: true, result: { added: 1 } });
    expect(handler).toHaveBeenCalledExactlyOnceWith({
      productId: "p1",
      quantity: 1,
    });
  });

  it("rejects invalid arguments without calling the handler", async () => {
    const handler = vi.fn();
    const { dispatcher, onError } = setup({
      functions: {
        addToCart: { parameters: z.object({ productId: z.string() }), handler },
      },
    });
    const result = await dispatcher.invoke(
      "addToCart",
      { productId: 42 },
      origin,
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid_arguments" },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("runs a hook tool exposed to generative UI with a synthetic tool-call context", async () => {
    const handler = vi.fn(
      async (_args: Record<string, unknown>, _context: any) => "applied",
    );
    const { dispatcher } = setup({
      tools: [
        {
          name: "applyCoupon",
          parameters: z.object({ code: z.string() }),
          handler,
          exposeToGenerativeUI: true,
        },
      ],
    });
    const result = await dispatcher.invoke(
      "applyCoupon",
      { code: "SAVE10" },
      origin,
    );
    expect(result).toEqual({ ok: true, result: "applied" });
    expect(handler.mock.calls[0][0]).toEqual({ code: "SAVE10" });
    expect(handler.mock.calls[0][1].toolCall.function).toEqual({
      name: "applyCoupon",
      arguments: JSON.stringify({ code: "SAVE10" }),
    });
  });

  it("fails closed for a tool that is not exposed or is disabled", async () => {
    const handler = vi.fn();
    const { dispatcher } = setup({
      tools: [
        { name: "removeFromCart", handler },
        {
          name: "applyCoupon",
          handler,
          exposeToGenerativeUI: true,
          available: false,
        },
      ],
    });
    expect(await dispatcher.invoke("removeFromCart", {}, origin)).toMatchObject(
      {
        ok: false,
        error: { code: "function_not_exposed" },
      },
    );
    expect(await dispatcher.invoke("applyCoupon", {}, origin)).toMatchObject({
      ok: false,
      error: { code: "function_not_exposed" },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("fails closed for a missing function", async () => {
    const { dispatcher } = setup();
    expect(await dispatcher.invoke("nope", {}, origin)).toMatchObject({
      ok: false,
      error: { code: "function_not_found" },
    });
  });

  it("refuses a name registered both on the provider and by an exposed hook tool", async () => {
    const providerHandler = vi.fn();
    const toolHandler = vi.fn();
    const { dispatcher } = setup({
      functions: { addToCart: { handler: providerHandler } },
      tools: [
        { name: "addToCart", handler: toolHandler, exposeToGenerativeUI: true },
      ],
    });
    expect(await dispatcher.invoke("addToCart", {}, origin)).toMatchObject({
      ok: false,
      error: { code: "function_conflict" },
    });
    expect(providerHandler).not.toHaveBeenCalled();
    expect(toolHandler).not.toHaveBeenCalled();
  });

  it("turns handler failures into results instead of throwing", async () => {
    const { dispatcher } = setup({
      functions: {
        sync: {
          handler: () => {
            throw new Error("boom");
          },
        },
        async: {
          handler: async () => {
            throw new Error("later");
          },
        },
      },
    });
    expect(await dispatcher.invoke("sync", {}, origin)).toMatchObject({
      ok: false,
      error: {
        code: "handler_failed",
        message: expect.stringContaining("boom"),
      },
    });
    expect(await dispatcher.invoke("async", {}, origin)).toMatchObject({
      ok: false,
      error: {
        code: "handler_failed",
        message: expect.stringContaining("later"),
      },
    });
  });

  it("lists provider functions and exposed tools only", () => {
    const { dispatcher } = setup({
      functions: {
        addToCart: {
          description: "Add",
          parameters: z.object({ productId: z.string() }),
          handler: vi.fn(),
        },
      },
      tools: [
        { name: "applyCoupon", handler: vi.fn(), exposeToGenerativeUI: true },
        { name: "removeFromCart", handler: vi.fn() },
      ],
    });
    const listed = dispatcher.listExposed();
    expect(Object.keys(listed).sort()).toEqual(["addToCart", "applyCoupon"]);
    expect(listed.addToCart).toMatchObject({
      description: "Add",
      parameters: {
        type: "object",
        properties: { productId: { type: "string" } },
      },
    });
    expect(listed.applyCoupon.parameters).toEqual({
      type: "object",
      properties: {},
    });
  });

  it("reports a validator that throws as invalid_arguments instead of rejecting", async () => {
    const handler = vi.fn();
    const { dispatcher, onError } = setup({
      functions: {
        addToCart: {
          parameters: z.object({ x: z.string() }).transform(() => {
            throw new Error("bad");
          }),
          handler,
        },
      },
    });
    await expect(
      dispatcher.invoke("addToCart", { x: "a" }, origin),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "invalid_arguments",
        message: expect.stringContaining("bad"),
      },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("reports a throwing source getter as a result instead of rejecting", async () => {
    const dispatcher = createGenerativeUIDispatcher({
      getProviderFunctions: () => ({}),
      getTool: () => {
        throw new Error("registry down");
      },
      listTools: () => [],
    });
    await expect(
      dispatcher.invoke("anything", {}, origin),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "handler_failed",
        message: expect.stringContaining("registry down"),
      },
    });
  });

  it("lists only the names invoke would accept", async () => {
    const handlers = {
      addToCart: vi.fn(),
      noHandler: undefined,
      hidden: vi.fn(),
    };
    const { dispatcher } = setup({
      functions: {
        addToCart: { handler: vi.fn() },
        checkout: { description: "Pay", handler: vi.fn() },
      },
      tools: [
        {
          name: "addToCart",
          handler: handlers.addToCart,
          exposeToGenerativeUI: true,
        },
        {
          name: "noHandler",
          handler: handlers.noHandler,
          exposeToGenerativeUI: true,
        },
        {
          name: "hidden",
          handler: handlers.hidden,
          exposeToGenerativeUI: true,
        },
        { name: "applyCoupon", handler: vi.fn(), exposeToGenerativeUI: true },
      ],
      isToolEnabled: (name) => name !== "hidden",
    });
    expect(Object.keys(dispatcher.listExposed()).sort()).toEqual([
      "applyCoupon",
      "checkout",
    ]);
    for (const name of ["addToCart", "noHandler", "hidden"]) {
      expect(await dispatcher.invoke(name, {}, origin)).toMatchObject({
        ok: false,
      });
    }
    expect(handlers.hidden).not.toHaveBeenCalled();
  });

  it("fails closed for an exposed tool disabled through isToolEnabled", async () => {
    const handler = vi.fn();
    const { dispatcher } = setup({
      tools: [{ name: "applyCoupon", handler, exposeToGenerativeUI: true }],
      isToolEnabled: () => false,
    });
    expect(await dispatcher.invoke("applyCoupon", {}, origin)).toMatchObject({
      ok: false,
      error: {
        code: "function_not_exposed",
        message: '"applyCoupon" is currently disabled',
      },
    });
    expect(handler).not.toHaveBeenCalled();
  });
});
