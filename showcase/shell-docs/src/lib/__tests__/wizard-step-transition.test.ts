import { describe, expect, it } from "vitest";
import { planStepSwap, STEP_TRANSITION_MS } from "@/lib/wizard-step-transition";
import type { StepDirection } from "@/lib/wizard-step-transition";

const BASE_INPUT = {
  fromHeight: 200,
  toHeight: 200,
  reducedMotion: false,
};

describe("planStepSwap — reduced motion", () => {
  it.each<StepDirection>(["forward", "back"])(
    "returns null for direction=%s",
    (direction) => {
      const plan = planStepSwap({
        ...BASE_INPUT,
        direction,
        reducedMotion: true,
      });

      expect(plan).toBeNull();
    },
  );
});

describe("planStepSwap — direction", () => {
  it("forward: incoming enters from the right (16px)", () => {
    const plan = planStepSwap({ ...BASE_INPUT, direction: "forward" });

    expect(plan).not.toBeNull();
    expect(plan!.incoming[0]).toEqual({
      transform: "translateX(16px)",
      opacity: 0,
    });
    expect(plan!.incoming[1]).toEqual({
      transform: "translateX(0)",
      opacity: 1,
    });
  });

  it("back: incoming enters from the left (-16px) — the mirror of forward", () => {
    const plan = planStepSwap({ ...BASE_INPUT, direction: "back" });

    expect(plan).not.toBeNull();
    expect(plan!.incoming[0]).toEqual({
      transform: "translateX(-16px)",
      opacity: 0,
    });
    expect(plan!.incoming[1]).toEqual({
      transform: "translateX(0)",
      opacity: 1,
    });
  });

  it("forward and back produce exactly opposite entry offsets, not just different ones", () => {
    const forward = planStepSwap({ ...BASE_INPUT, direction: "forward" });
    const back = planStepSwap({ ...BASE_INPUT, direction: "back" });

    expect(forward!.incoming[0].transform).toBe("translateX(16px)");
    expect(back!.incoming[0].transform).toBe("translateX(-16px)");
  });

  it.each<StepDirection>(["forward", "back"])(
    "incoming always ends at translateX(0) / opacity 1 (direction=%s)",
    (direction) => {
      const plan = planStepSwap({ ...BASE_INPUT, direction });

      expect(plan!.incoming[1]).toEqual({
        transform: "translateX(0)",
        opacity: 1,
      });
    },
  );
});

describe("planStepSwap — wrapper height", () => {
  it("returns null when the heights are equal", () => {
    const plan = planStepSwap({
      direction: "forward",
      fromHeight: 340,
      toHeight: 340,
      reducedMotion: false,
    });

    expect(plan!.wrapper).toBeNull();
  });

  it("returns a two-frame height animation carrying both values as px strings when heights differ", () => {
    const plan = planStepSwap({
      direction: "forward",
      fromHeight: 220,
      toHeight: 480,
      reducedMotion: false,
    });

    expect(plan!.wrapper).toEqual([{ height: "220px" }, { height: "480px" }]);
  });

  it("clamps a negative height to 0 before building the wrapper animation", () => {
    const plan = planStepSwap({
      direction: "forward",
      fromHeight: -40,
      toHeight: 300,
      reducedMotion: false,
    });

    expect(plan!.wrapper).toEqual([{ height: "0px" }, { height: "300px" }]);
  });
});

describe("planStepSwap — options", () => {
  it("carries STEP_TRANSITION_MS as the duration", () => {
    const plan = planStepSwap({ ...BASE_INPUT, direction: "forward" });

    expect(plan!.options.duration).toBe(STEP_TRANSITION_MS);
  });

  // A `"forwards"` fill would hold the wrapper (or the incoming card) at its
  // end value once the animation stops — safe only if something releases
  // that pin later. Nothing does, on purpose: see the header comment on why
  // there is no outgoing-clone cleanup to hang a release off of any more.
  it("never sets fill to 'forwards'", () => {
    const plan = planStepSwap({ ...BASE_INPUT, direction: "forward" });

    expect(plan!.options.fill).not.toBe("forwards");
  });
});
