/**
 * Presenter/booth dev-reset route for the exec skin.
 *
 * Shape lifted from logistics' `route.memory.test.ts` FORBIDDEN case
 * (`vi.stubEnv("NODE_ENV", "production")`, no `PRESENTER_RESET_ENABLED`
 * override) combined with the REAL, unmocked store (like logistics'
 * `route.test.ts`): mutate the store first, then assert the mutation either
 * survives a refusal or is wiped by a successful reset.
 *
 * The route does not exist yet — this file is expected to fail at module
 * resolution (`./route` has no `route.ts` sibling) until it is implemented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import * as store from "@/skins/exec/data/store";

beforeEach(() => store.reset());
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/exec/v1/dev/reset", () => {
  it("403s FORBIDDEN in production when presenter reset is disabled, and leaves the store untouched", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const [breach] = store.exceptions().filter((e) => !e.explained);
    store.fileNarrative({
      metricId: breach.metricId,
      period: breach.period,
      code: "VAR-TIMING",
      body: "Shipment timing shift.",
      source: "typed",
    });

    const res = await POST();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "FORBIDDEN" });
    // The mutation survives — a refusal must not touch the store.
    expect(store.snapshot().narratives).toHaveLength(1);
  });

  it("resets the store back to seed when PRESENTER_RESET_ENABLED is set, even in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PRESENTER_RESET_ENABLED", "true");

    const [breach] = store.exceptions().filter((e) => !e.explained);
    store.fileNarrative({
      metricId: breach.metricId,
      period: breach.period,
      code: "VAR-TIMING",
      body: "Shipment timing shift.",
      source: "typed",
    });

    const res = await POST();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      reset: expect.arrayContaining(["store"]),
    });
    // Seed state has no narratives — the filed one above is gone.
    expect(store.snapshot().narratives).toHaveLength(0);
  });
});
