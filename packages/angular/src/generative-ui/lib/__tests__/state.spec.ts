import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createGenerativeUI } from "../catalog";
import { GENERATIVE_UI_RUNTIME } from "../runtime";
import {
  connectGenerativeUIState,
  registerGenerativeUIFunction,
} from "../state";
import { createTestRuntime } from "./render";

const ui = createGenerativeUI({
  id: "test/state@1",
  state: {
    cart: z.object({ count: z.number(), coupon: z.string().default("none") }),
  },
  functions: { addToCart: { parameters: z.object({ productId: z.string() }) } },
  components: {},
});

describe("connectGenerativeUIState", () => {
  afterEach(() => vi.restoreAllMocks());

  @Component({ template: "" })
  class Host {
    readonly count = signal(1);
    constructor() {
      connectGenerativeUIState(ui, "cart", () => ({ count: this.count() }));
    }
  }

  it("stores the value parsed with the state schema, follows changes and removes it on destroy", () => {
    const { runtime } = createTestRuntime(ui);
    TestBed.configureTestingModule({
      providers: [{ provide: GENERATIVE_UI_RUNTIME, useValue: runtime }],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    // Defaults apply: selectors get the parsed output.
    expect(runtime.manager.getState()).toEqual({
      cart: { count: 1, coupon: "none" },
    });
    fixture.componentInstance.count.set(2);
    fixture.detectChanges();
    expect(runtime.manager.getState()).toEqual({
      cart: { count: 2, coupon: "none" },
    });
    fixture.destroy();
    expect(runtime.manager.getState()).toEqual({});
  });

  it("does not store an invalid value and removes the earlier one", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { runtime } = createTestRuntime(ui);
    TestBed.configureTestingModule({
      providers: [{ provide: GENERATIVE_UI_RUNTIME, useValue: runtime }],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    expect(runtime.manager.getState().cart).toBeDefined();
    fixture.componentInstance.count.set("many" as unknown as number);
    fixture.detectChanges();
    expect(runtime.manager.getState().cart).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('invalid value for "cart"'),
    );
  });
});

describe("registerGenerativeUIFunction", () => {
  @Component({ template: "" })
  class Host {
    readonly handler = vi.fn(
      (args: { productId: string }) => `ok ${args.productId}`,
    );
    constructor() {
      registerGenerativeUIFunction(ui, "addToCart", this.handler);
    }
  }

  it("mounts the handler for the lifetime of the component", async () => {
    const { runtime } = createTestRuntime(ui);
    TestBed.configureTestingModule({
      providers: [{ provide: GENERATIVE_UI_RUNTIME, useValue: runtime }],
    });
    expect(runtime.dispatcher.handlerCount("addToCart")).toBe(0);
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    expect(runtime.dispatcher.handlerCount("addToCart")).toBe(1);
    const result = await runtime.dispatcher.invoke(
      "addToCart",
      { productId: "p1" },
      { surfaceId: "s", componentId: "c" },
    );
    expect(result).toEqual({ ok: true, result: "ok p1" });
    fixture.destroy();
    expect(runtime.dispatcher.handlerCount("addToCart")).toBe(0);
  });
});
