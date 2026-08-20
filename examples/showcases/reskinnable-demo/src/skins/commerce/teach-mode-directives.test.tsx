import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommerceStoreState, Operator } from "./data/types";
import {
  SAVE_PROCEDURE_CONFIRMED,
  SAVE_PROCEDURE_DECLINED,
  buildDemonstrationDirective,
  classifySaveProcedureResult,
  readDemonstratedStepCount,
} from "./teach-mode-directives";

/** The `{ args, status, result, respond }` render a HITL registration gets. */
type ToolRender = (props: {
  args?: Record<string, unknown>;
  result?: unknown;
  respond?: (value: string) => void;
  toolCallId?: string;
}) => ReactNode;

// CommerceTools registers into CopilotKit and renders null, so the only way to
// reach a card's render is to capture the registrations as they are made.
const { renders } = vi.hoisted(() => ({
  renders: new Map<string, unknown>(),
}));

vi.mock("@copilotkit/react-core/v2", () => ({
  useAgentContext: () => {},
  useComponent: () => {},
  useFrontendTool: (config: { name: string; render?: unknown }) => {
    if (config.render) renders.set(config.name, config.render);
  },
  useHumanInTheLoop: (config: { name: string; render: unknown }) => {
    renders.set(config.name, config.render);
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/shell/skin-provider", () => ({
  useSkin: () => ({ id: "commerce" }),
}));

vi.mock("@/shell/skin-path", () => ({
  useSkinHref: () => (path: string) => path,
}));

const EMPTY_LEDGER: CommerceStoreState = {
  products: [],
  floors: [],
  orders: [],
  notifications: [],
  returns: [],
  promotions: [],
  waivers: [],
  plans: [],
  operators: [],
};

const OPERATOR: Operator = {
  id: "op-nadia",
  name: "Nadia Okonjo",
  role: "merch-lead",
  team: "Merchandising",
};

vi.mock("./data/ledger-context", () => ({
  useCommerceLedger: () => ({
    data: EMPTY_LEDGER,
    // `refresh` resolves a boolean: `true` = a fresh snapshot was committed.
    refresh: async () => true,
    operator: OPERATOR,
    setOperatorId: () => {},
  }),
}));

// Only `useRecording` is stubbed; the rest of the shell teach module is passed
// through, so a component that renders `RecordingProvider` / `RecordingVignette`
// / `RecordingFeed` anywhere in this graph still gets the real one.
vi.mock("@/shell/teach", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shell/teach")>()),
  useRecording: () => ({
    isRecording: false,
    steps: [],
    beginRecording: () => {},
    endRecording: () => {},
    logStep: () => {},
    getDemonstratedCode: () => null,
  }),
}));

// Imported after the mocks so it binds the stubbed modules.
import { CommerceTools } from "./tools";

function cardRenderFor(name: string): ToolRender {
  render(<CommerceTools />);
  const found = renders.get(name);
  if (typeof found !== "function") {
    throw new Error(`${name} did not register a render`);
  }
  return found as ToolRender;
}

const saveProcedureRender = () => cardRenderFor("saveLearnedProcedure");

describe("classifySaveProcedureResult", () => {
  it("reports pending while the card is unanswered", () => {
    expect(classifySaveProcedureResult(undefined)).toBe("pending");
    expect(classifySaveProcedureResult(null)).toBe("pending");
    expect(classifySaveProcedureResult({ ok: true })).toBe("pending");
    expect(classifySaveProcedureResult("   ")).toBe("pending");
  });

  it("separates the two directives that both settle as strings", () => {
    expect(classifySaveProcedureResult(SAVE_PROCEDURE_CONFIRMED)).toBe("saved");
    expect(classifySaveProcedureResult(SAVE_PROCEDURE_DECLINED)).toBe(
      "declined",
    );
  });

  it("never guesses 'saved' for a string it cannot explain", () => {
    expect(classifySaveProcedureResult("ok")).toBe("unknown");
    expect(classifySaveProcedureResult("The user said no thanks.")).toBe(
      "unknown",
    );
    expect(classifySaveProcedureResult("They declined.")).toBe("declined");
  });
});

/**
 * THREE real steps, two of whose labels carry a numeral-dot-space the old
 * derivation scored as a step of its own ("1. " and "2. ") — five matches for
 * three steps. Step labels interpolate free text from the ledger (promotion and
 * product names), so a rename is all it takes to get there.
 */
const DECIMAL_STEPS = [
  "Marked Cedar Hoodie down to $1. 50 under the floor",
  "Filed a MARGIN-EXEC-OK margin waiver on Cedar Hoodie 2. 0 markdown",
  "Approved the markdown on Cedar Hoodie autumn markdown",
];

/**
 * The step count is REPORTED by the recorder, never recounted from the directive
 * it wrote. The card used to count `/\d+\.\s/` matches in that prose, so a step
 * label carrying a numeral-dot-space added a step that does not exist — and the
 * count is the claim beat 6 rests on.
 */
describe("the demonstration directive (beat 6)", () => {
  it("reports the true count when a step label contains a numeral-dot-space", () => {
    const directive = buildDemonstrationDirective({
      steps: DECIMAL_STEPS,
      code: "MARGIN-EXEC-OK",
    });

    expect(readDemonstratedStepCount(directive)).toBe(3);
    // The shape the old derivation read, proving the labels really do carry the
    // numerals that inflated it: five matches for three steps.
    expect((directive.match(/\d+\.\s/g) ?? []).length).toBe(5);
  });

  it("is unchanged for ordinary steps, and counts one step singular", () => {
    expect(
      readDemonstratedStepCount(
        buildDemonstrationDirective({
          steps: ["Opened Promotions", "Approved the markdown"],
          code: null,
        }),
      ),
    ).toBe(2);
    const one = buildDemonstrationDirective({
      steps: ["Approved the markdown"],
      code: null,
    });
    expect(one).toContain("after 1 step.");
    expect(readDemonstratedStepCount(one)).toBe(1);
  });

  it("reports zero rather than nothing when the recorder caught nothing", () => {
    const empty = buildDemonstrationDirective({ steps: [], code: null });
    expect(empty).toContain("(nothing captured)");
    expect(readDemonstratedStepCount(empty)).toBe(0);
  });

  it("keeps the observed list and the waiver code the agent needs", () => {
    const directive = buildDemonstrationDirective({
      steps: ["Opened Promotions", "Filed a waiver"],
      code: "MARGIN-EXEC-OK",
    });

    expect(directive).toContain("1. Opened Promotions");
    expect(directive).toContain("2. Filed a waiver");
    expect(directive).toContain(
      "The waiver code they used was MARGIN-EXEC-OK.",
    );
    expect(buildDemonstrationDirective({ steps: ["x"], code: null })).toContain(
      "No waiver code was captured.",
    );
  });

  it("claims no count for a string that never reported one", () => {
    // A thread recorded before this contract, and anything else that settles it.
    expect(
      readDemonstratedStepCount(
        "The user finished. Observed steps:\n1. Opened",
      ),
    ).toBeNull();
    expect(readDemonstratedStepCount(undefined)).toBeNull();
    expect(readDemonstratedStepCount("1. one 2. two")).toBeNull();
  });
});

describe("awaitDemonstration card (beat 6)", () => {
  afterEach(() => {
    cleanup();
    renders.clear();
  });

  it("prints the reported count, not one recounted from the prose", () => {
    const settled = buildDemonstrationDirective({
      steps: DECIMAL_STEPS,
      code: "MARGIN-EXEC-OK",
    });
    const demoRender = cardRenderFor("awaitDemonstration");
    render(<>{demoRender({ result: settled })}</>);

    expect(screen.getByText(/Recorded 3 steps\./)).toBeTruthy();
    expect(screen.queryByText(/5 steps/)).toBeNull();
  });

  it("stays vague rather than guessing for a directive with no count", () => {
    const demoRender = cardRenderFor("awaitDemonstration");
    render(<>{demoRender({ result: "The user finished. Observed steps:" })}</>);

    expect(screen.getByText(/Recorded the demonstration\./)).toBeTruthy();
  });
});

describe("saveLearnedProcedure card (beat 6)", () => {
  afterEach(() => {
    cleanup();
    renders.clear();
  });

  it("offers both choices while unanswered", () => {
    const cardRender = saveProcedureRender();
    render(<>{cardRender({ args: { procedure: "1. File a waiver" } })}</>);

    expect(screen.getByText(/File a waiver/)).toBeTruthy();
    expect(screen.getByText(/Remember it/)).toBeTruthy();
    expect(screen.getByText(/Don’t save/)).toBeTruthy();
  });

  it("shows the saved receipt only when the user confirmed", () => {
    const cardRender = saveProcedureRender();
    render(<>{cardRender({ result: SAVE_PROCEDURE_CONFIRMED })}</>);

    expect(screen.getByText(/Saved\./)).toBeTruthy();
  });

  // THE REGRESSION. Both buttons settle this tool with a string, so a render
  // that branches on `typeof result === "string"` claims a durable write after
  // "Don't save" — live, and again on every thread replay.
  it("does NOT claim a durable write after the user declined", () => {
    const cardRender = saveProcedureRender();
    render(<>{cardRender({ result: SAVE_PROCEDURE_DECLINED })}</>);

    expect(screen.queryByText(/Saved\./)).toBeNull();
    expect(screen.queryByText(/use this next time/)).toBeNull();
    expect(screen.getByText(/nothing was written to memory/)).toBeTruthy();
  });

  it("asserts neither outcome for a result it cannot explain", () => {
    const cardRender = saveProcedureRender();
    render(<>{cardRender({ result: "something else entirely" })}</>);

    expect(screen.queryByText(/Saved\./)).toBeNull();
    expect(screen.getByText(/already answered/)).toBeTruthy();
  });
});
