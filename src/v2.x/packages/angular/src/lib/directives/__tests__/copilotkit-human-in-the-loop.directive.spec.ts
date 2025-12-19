import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { HumanInTheLoop } from "../../human-in-the-loop";

describe("HumanInTheLoop service", () => {
  it("resolves when matching result is provided", async () => {
    TestBed.configureTestingModule({ providers: [HumanInTheLoop] });
    const service = TestBed.inject(HumanInTheLoop);

    const promise = service.onResult("call-1", "approval");
    service.addResult("call-1", "approval", { status: "ok" });

    await expect(promise).resolves.toEqual({
      toolCallId: "call-1",
      toolName: "approval",
      result: { status: "ok" },
    });
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
    await expect(promise).resolves.toEqual({
      toolCallId: "call-2",
      toolName: "verify",
      result: "ok",
    });
  });
});
