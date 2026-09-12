import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { HumanInTheLoop } from "../../human-in-the-loop";

describe("HumanInTheLoop service", () => {
  it("resolves when matching result is provided", async () => {
    TestBed.configureTestingModule({ providers: [HumanInTheLoop] });
    const service = TestBed.inject(HumanInTheLoop);

    const promise = service.onResult("call-1", "approval");
    service.addResult("call-1", "approval", { status: "ok" });

    await expect(promise).resolves.toEqual({ status: "ok" });
  });

  it("ignores non-matching results until criteria matches", async () => {
    TestBed.configureTestingModule({ providers: [HumanInTheLoop] });
    const service = TestBed.inject(HumanInTheLoop);

    const promise = service.onResult("call-2", "verify");

    service.addResult("call-2", "other", "nope");

    const race = Promise.race([
      promise,
      new Promise((resolve) => setTimeout(() => resolve("pending"), 20)),
    ]);

    await expect(race).resolves.toBe("pending");

    service.addResult("call-2", "verify", "ok");
    await expect(promise).resolves.toBe("ok");
  });

  it("does not leak the bus routing keys into the resolved result", async () => {
    TestBed.configureTestingModule({ providers: [HumanInTheLoop] });
    const service = TestBed.inject(HumanInTheLoop);

    const promise = service.onResult("call-3", "request_page_oncall");
    service.addResult("call-3", "request_page_oncall", { approved: true });

    const resolved = await promise;

    // A leaked envelope makes an agent read the answer as
    // {toolName, result} instead of {approved: true}, so a gate keyed on
    // `approved` silently never fires.
    expect(resolved).not.toHaveProperty("toolName");
    expect(resolved).not.toHaveProperty("toolCallId");
    expect(resolved).toEqual({ approved: true });
  });
});
