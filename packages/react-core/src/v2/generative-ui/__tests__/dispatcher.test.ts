import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { StandardSchemaV1 } from "@copilotkit/shared";
import { createGenerativeUIDispatcher } from "../dispatcher";
import type {
  GenerativeUIDeclaredFunction,
  GenerativeUIHandlerRef,
} from "../dispatcher";

const origin = { surfaceId: "s1", componentId: "c1" };

const cartSchema = z.object({
  productId: z.string(),
  quantity: z.number().default(1),
});

function setup(declared: Record<string, GenerativeUIDeclaredFunction> = {}) {
  const onError = vi.fn();
  const dispatcher = createGenerativeUIDispatcher({
    getDeclared: () => new Map(Object.entries(declared)),
    onError,
  });
  return { dispatcher, onError };
}

function refOf(handler: GenerativeUIHandlerRef["current"]) {
  const ref: GenerativeUIHandlerRef = { current: handler };
  return ref;
}

/** A valid Standard Schema that has no JSON Schema conversion. */
function customSchema() {
  const schema: StandardSchemaV1 = {
    "~standard": {
      version: 1,
      vendor: "custom",
      validate: (value) => ({ value }),
    },
  };
  return schema;
}

describe("createGenerativeUIDispatcher", () => {
  it("runs the mounted handler with schema defaults applied and returns its result", async () => {
    const { dispatcher, onError } = setup({
      addToCart: { parameters: cartSchema },
    });
    const handler = vi.fn((args: { productId: string; quantity: number }) => ({
      added: args.quantity,
    }));
    dispatcher.register("addToCart", refOf(handler));

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
    expect(onError).not.toHaveBeenCalled();
  });

  it("returns invalid_arguments without calling the handler", async () => {
    const { dispatcher, onError } = setup({
      addToCart: { parameters: cartSchema },
    });
    const handler = vi.fn();
    dispatcher.register("addToCart", refOf(handler));

    const result = await dispatcher.invoke(
      "addToCart",
      { productId: 42 },
      origin,
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "invalid_arguments",
        message: expect.stringContaining("productId"),
      },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledExactlyOnceWith({
      name: "addToCart",
      origin,
      error: expect.objectContaining({ code: "invalid_arguments" }),
    });
  });

  it("returns invalid_arguments when the schema itself throws", async () => {
    const { dispatcher } = setup({
      addToCart: {
        parameters: z.object({ x: z.string() }).transform(() => {
          throw new Error("bad");
        }),
      },
    });
    const handler = vi.fn();
    dispatcher.register("addToCart", refOf(handler));

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
  });

  it("returns function_not_found for a name that is not declared, even with a handler", async () => {
    const { dispatcher } = setup();
    const handler = vi.fn();
    dispatcher.register("removeFromCart", refOf(handler));

    expect(await dispatcher.invoke("removeFromCart", {}, origin)).toMatchObject(
      {
        ok: false,
        error: { code: "function_not_found" },
      },
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns function_not_found for a declared name with no mounted handler", async () => {
    const { dispatcher } = setup({ addToCart: { parameters: cartSchema } });

    expect(
      await dispatcher.invoke("addToCart", { productId: "p1" }, origin),
    ).toMatchObject({
      ok: false,
      error: {
        code: "function_not_found",
        message: expect.stringContaining("no useGenerativeUIFunction handler"),
      },
    });
  });

  it("stops after unregister and works again after a new register", async () => {
    const { dispatcher } = setup({ addToCart: { parameters: cartSchema } });
    const unregister = dispatcher.register(
      "addToCart",
      refOf(() => "first"),
    );
    unregister();

    expect(
      await dispatcher.invoke("addToCart", { productId: "p1" }, origin),
    ).toMatchObject({ ok: false, error: { code: "function_not_found" } });

    dispatcher.register(
      "addToCart",
      refOf(() => "second"),
    );
    expect(
      await dispatcher.invoke("addToCart", { productId: "p1" }, origin),
    ).toEqual({ ok: true, result: "second" });
  });

  it("runs the latest handler after the ref changes, without a new register", async () => {
    const { dispatcher } = setup({ addToCart: { parameters: cartSchema } });
    const ref = refOf(() => "old");
    dispatcher.register("addToCart", ref);
    ref.current = () => "new";

    expect(
      await dispatcher.invoke("addToCart", { productId: "p1" }, origin),
    ).toEqual({ ok: true, result: "new" });
  });

  it("returns function_conflict with two handlers and works again after one unregisters", async () => {
    const { dispatcher } = setup({ addToCart: { parameters: cartSchema } });
    const first = vi.fn(() => "first");
    const second = vi.fn(() => "second");
    const unregisterFirst = dispatcher.register("addToCart", refOf(first));
    dispatcher.register("addToCart", refOf(second));

    expect(
      await dispatcher.invoke("addToCart", { productId: "p1" }, origin),
    ).toMatchObject({ ok: false, error: { code: "function_conflict" } });
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();

    unregisterFirst();
    expect(
      await dispatcher.invoke("addToCart", { productId: "p1" }, origin),
    ).toEqual({ ok: true, result: "second" });
  });

  it("returns handler_failed when the handler throws, sync or async", async () => {
    const { dispatcher } = setup({
      sync: { parameters: z.object({}) },
      async: { parameters: z.object({}) },
    });
    dispatcher.register(
      "sync",
      refOf(() => {
        throw new Error("boom");
      }),
    );
    dispatcher.register(
      "async",
      refOf(async () => {
        throw new Error("later");
      }),
    );

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

  it("resolves with the failed result when onError throws", async () => {
    const dispatcher = createGenerativeUIDispatcher({
      getDeclared: () => new Map(),
      onError: () => {
        throw new Error("logger down");
      },
    });

    await expect(dispatcher.invoke("nope", {}, origin)).resolves.toMatchObject({
      ok: false,
      error: { code: "function_not_found" },
    });
  });

  it("does not throw when getDeclared throws", async () => {
    const dispatcher = createGenerativeUIDispatcher({
      getDeclared: () => {
        throw new Error("registry down");
      },
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
    expect(dispatcher.listExposed()).toEqual({});
  });

  it("lists only declared functions with exactly one handler and a convertible schema", () => {
    const { dispatcher } = setup({
      addToCart: {
        description: "Add a product to the cart",
        parameters: z.object({ productId: z.string() }),
      },
      applyCoupon: { parameters: z.object({ code: z.string() }) },
      checkout: { parameters: z.object({}) },
      track: { parameters: customSchema() },
    });
    dispatcher.register("addToCart", refOf(vi.fn()));
    dispatcher.register("applyCoupon", refOf(vi.fn()));
    dispatcher.register("applyCoupon", refOf(vi.fn()));
    dispatcher.register("track", refOf(vi.fn()));
    dispatcher.register("undeclared", refOf(vi.fn()));

    expect(dispatcher.listExposed()).toEqual({
      addToCart: {
        description: "Add a product to the cart",
        parameters: {
          type: "object",
          properties: { productId: { type: "string" } },
          required: ["productId"],
          additionalProperties: false,
        },
      },
    });
  });
});
