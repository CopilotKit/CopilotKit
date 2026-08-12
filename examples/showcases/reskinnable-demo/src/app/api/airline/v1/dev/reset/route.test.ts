import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "./route";
import * as store from "@/skins/airline/data/store";

beforeEach(() => store.reset());
afterEach(() => vi.unstubAllEnvs());

describe("POST /dev/reset", () => {
  it("puts back everything the beats wrote", async () => {
    const booking = store.findBooking("bkg-av1466");
    const gated = store.findBooking("bkg-av2214");
    const option = store.options()[0];
    if (!booking || !gated) throw new Error("missing fixture");

    store.reissueBooking(booking, option, 0, "involuntary");
    store.notifyParty(booking, "arrival-pickup", "new-arrival-time");
    const filed = store.fileException(
      gated,
      "SCHEDULE_CHANGE_TRIGGERED",
      "notice AV-88214",
      "",
    );
    if (!filed.ok) throw new Error("could not file");
    store.approveException(filed.exception.id);

    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reset).toEqual(["store"]);

    expect(store.findBooking("bkg-av1466")?.status).toBe("ticketed");
    expect(store.findBooking("bkg-av1466")?.notices).toEqual([]);
    expect(store.findBooking("bkg-av2214")?.activeExceptionId).toBeNull();
    expect(store.exceptions()).toEqual([]);
    expect(store.briefs()).toEqual([]);
  });

  it("SAYS OUT LOUD that the memory beats are not re-armed", async () => {
    // `demo-beats.md`: a reset route with no seed-memories module "restores its
    // data store only and CANNOT reset those beats — which is a silent trap,
    // because its Reset button looks identical". This field is what stops it
    // being silent, so it is asserted rather than assumed.
    const body = await (await POST()).json();
    expect(body.memoryBeats).toBe("unarmed");
    expect(body.reset).not.toContain("memory");
    expect(body.memoryNote).toContain("seed-memories");
  });

  it("403s in production unless a booth deployment enabled it", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PRESENTER_RESET_ENABLED", "");
    expect((await POST()).status).toBe(403);

    vi.stubEnv("PRESENTER_RESET_ENABLED", "true");
    expect((await POST()).status).toBe(200);
  });

  it("is allowed outside production without the flag", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PRESENTER_RESET_ENABLED", "");
    expect((await POST()).status).toBe(200);
  });
});
