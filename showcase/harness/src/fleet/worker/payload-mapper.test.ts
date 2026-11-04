import { describe, expect, it } from "vitest";
import {
  createD6PayloadToInput,
  createPayloadToInput,
  E2E_D6_DRIVER_KIND,
  E2E_DEMOS_DRIVER_KIND,
  E2E_SMOKE_DRIVER_KIND,
} from "./payload-mapper.js";
import type { ServiceJobPayload } from "../contracts.js";
import { e2eFullDriver } from "../../probes/drivers/d6-all-pills.js";

function payload(over: Partial<ServiceJobPayload> = {}): ServiceJobPayload {
  return {
    probeKey: "d6:langgraph-python",
    serviceSlug: "langgraph-python",
    driverKind: "e2e_d6",
    meta: {
      runId: "frun_1",
      triggered: false,
      enqueuedAt: "2026-01-01T00:00:00Z",
    },
    ...over,
  };
}

describe("createD6PayloadToInput", () => {
  it("re-hydrates the serialized driver input verbatim", () => {
    const map = createD6PayloadToInput();
    const input = map(
      payload({
        driverInputs: {
          key: "d6-all-pills-e2e:langgraph-python",
          backendUrl: "https://lg.example.com",
          demos: ["shared-state", "human-in-the-loop"],
          shape: "package",
        },
      }),
    ) as Record<string, unknown>;

    expect(input.key).toBe("d6-all-pills-e2e:langgraph-python");
    expect(input.backendUrl).toBe("https://lg.example.com");
    expect(input.demos).toEqual(["shared-state", "human-in-the-loop"]);
    expect(input.shape).toBe("package");
  });

  it("defaults a missing key to the payload probeKey", () => {
    const map = createD6PayloadToInput();
    const input = map(
      payload({ driverInputs: { backendUrl: "https://lg.example.com" } }),
    ) as Record<string, unknown>;

    expect(input.key).toBe("d6:langgraph-python");
    expect(input.backendUrl).toBe("https://lg.example.com");
  });

  it("does not mutate the payload's driverInputs object", () => {
    const map = createD6PayloadToInput();
    const driverInputs: Record<string, unknown> = {
      backendUrl: "https://lg.example.com",
    };
    map(payload({ driverInputs }));
    expect(driverInputs).toEqual({ backendUrl: "https://lg.example.com" });
    expect("key" in driverInputs).toBe(false);
  });

  it("returns undefined when the payload carries no driver inputs", () => {
    const map = createD6PayloadToInput();
    expect(map(payload())).toBeUndefined();
    expect(map(payload({ driverInputs: undefined }))).toBeUndefined();
  });
});

describe("driver-kind constants", () => {
  it("expose the browser driver kinds matching the driver factories", () => {
    // `e2e_deep` was removed: D5 now runs the `e2e_d6` driver, differentiated
    // by its driver inputs (`representativeOnly` + `rowPrefix`), not by kind.
    expect(E2E_D6_DRIVER_KIND).toBe("e2e_d6");
    expect(E2E_DEMOS_DRIVER_KIND).toBe("e2e_demos");
    expect(E2E_SMOKE_DRIVER_KIND).toBe("e2e_smoke");
  });
});

describe("shared payload mapper", () => {
  // The three browser driver families share the SAME re-hydration logic (each
  // serializes a `{ key, backendUrl, … }` object and validates via its own zod
  // schema), so every registry entry wires the single `createPayloadToInput`.
  // `createD6PayloadToInput` is retained as a back-compat alias of it.
  const driverInputs = {
    key: "k:langgraph-python",
    backendUrl: "https://lg.example.com",
  };

  it("re-hydrates the serialized input", () => {
    const map = createPayloadToInput();
    const input = map(payload({ driverInputs })) as Record<string, unknown>;
    expect(input.key).toBe("k:langgraph-python");
    expect(input.backendUrl).toBe("https://lg.example.com");
  });

  it("defaults a missing key to the payload probeKey", () => {
    const map = createPayloadToInput();
    const input = map(
      payload({ driverInputs: { backendUrl: "https://lg.example.com" } }),
    ) as Record<string, unknown>;
    expect(input.key).toBe("d6:langgraph-python");
  });

  it("createD6PayloadToInput is the same factory (back-compat alias)", () => {
    expect(createD6PayloadToInput).toBe(createPayloadToInput);
  });
});

describe("inputSchema validation gate", () => {
  // The fleet worker calls `driver.run(ctx, input)` with NO validation — only
  // the legacy in-process invoker runs `driver.inputSchema.safeParse`. So the
  // mapper is the fleet path's gate. These tests pin that contract.
  it("passes a schema-valid input straight through", () => {
    const map = createPayloadToInput(e2eFullDriver.inputSchema);
    const input = map(
      payload({
        driverInputs: {
          key: "d6:langgraph-python",
          backendUrl: "https://lg.example.com",
        },
      }),
    ) as Record<string, unknown>;

    expect(input.backendUrl).toBe("https://lg.example.com");
  });

  it("throws on an empty backendUrl — the whole-column-red production bug", () => {
    // A service with no Railway serviceInstance in the probed environment
    // enumerates with `publicUrl: ""`, which the producer serializes as
    // `backendUrl: ""`. Unvalidated, that reached `${backendUrl}${route}` in the
    // d6 driver as a RELATIVE path and failed every cell with
    // `page.goto` → "Cannot navigate to invalid URL".
    const map = createPayloadToInput(e2eFullDriver.inputSchema);

    expect(() =>
      map(payload({ driverInputs: { key: "d6:x", backendUrl: "" } })),
    ).toThrow(/inputSchema/);
  });

  it("names the offending driverKind and surfaces the zod message", () => {
    const map = createPayloadToInput(e2eFullDriver.inputSchema);
    // The loop's payloadToInput catch appends this message to the
    // `worker-protocol-violation` it reports, so it must identify the problem.
    expect(() =>
      map(
        payload({
          driverKind: "e2e_d6",
          driverInputs: { key: "d6:x", backendUrl: "not-a-url" },
        }),
      ),
    ).toThrow(/driverKind "e2e_d6"/);
  });

  it("validates AFTER defaulting key, so an omitted key is not rejected", () => {
    // `key` is the mapper's own responsibility to fill; validating first would
    // reject inputs the mapper is about to make valid.
    const map = createPayloadToInput(e2eFullDriver.inputSchema);
    const input = map(
      payload({ driverInputs: { backendUrl: "https://lg.example.com" } }),
    ) as Record<string, unknown>;

    expect(input.key).toBe("d6:langgraph-python");
  });

  it("still returns undefined (not a throw) when there are no driverInputs", () => {
    // "Nothing to run" stays distinguishable from "malformed input": the loop
    // reports the former via the unmappable path, the latter via the catch.
    const map = createPayloadToInput(e2eFullDriver.inputSchema);
    expect(map(payload())).toBeUndefined();
  });

  it("skips validation entirely when no schema is supplied", () => {
    // Back-compat: the pre-existing no-arg call sites keep pure re-hydration.
    const map = createPayloadToInput();
    const input = map(
      payload({ driverInputs: { key: "d6:x", backendUrl: "" } }),
    ) as Record<string, unknown>;

    expect(input.backendUrl).toBe("");
  });

  it("accepts any structural safeParse implementation", () => {
    // The parameter is a minimal structural interface, not a zod import.
    const map = createPayloadToInput({
      safeParse: () => ({ success: false, error: { message: "nope" } }),
    });

    expect(() => map(payload({ driverInputs: { key: "d6:x" } }))).toThrow(
      /nope/,
    );
  });
});
