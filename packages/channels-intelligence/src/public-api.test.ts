import { describe, expectTypeOf, it } from "vitest";
import type { IntelligenceAdapter } from "./index.js";
import type { IntelligenceAdapterOptions } from "./index.js";

describe("channels-intelligence public API", () => {
  it("keeps IntelligenceAdapter construction to its single public options object", () => {
    expectTypeOf<
      ConstructorParameters<typeof IntelligenceAdapter>
    >().toEqualTypeOf<[opts?: IntelligenceAdapterOptions]>();
    expectTypeOf<
      "terminalBatchingEnabled" extends keyof IntelligenceAdapterOptions
        ? true
        : false
    >().toEqualTypeOf<false>();
  });
});
