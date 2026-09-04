import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  DemonstrationSettle,
  EXEC_SETTLES,
  OfferSettle,
  SaveProcedureSettle,
  SettleReceipt,
  classifyToolSettle,
} from "./tools";

/**
 * Every render in `tools.tsx` reads the SAME kind of value: whatever string
 * the tool (or the HITL card's `respond`) settled the call with. There are
 * five things that string can be, and only ONE of them is a success:
 *
 *  - a success sentence the handler wrote  (`respond("…")`, or a return value)
 *  - a JSON-encoded gate refusal           (`respond({ error, breaches })`)
 *  - a cancel sentence the card wrote      (its own Cancel button)
 *  - the platform's abort sentinel         — `"Error: Human-in-the-loop
 *    interaction aborted"`, which CopilotKit settles an interrupt with when
 *    the run ends while the card was NEVER answered
 *  - an error-prefixed relay               (anything starting "Error…")
 *
 * The bug these tests exist for: a render that branches on
 * `typeof result === "string"` and calls everything-that-isn't-a-refusal a
 * success prints a GREEN receipt over a cancel and over the abort sentinel —
 * a board pack "published" on stage that was never published, and identically
 * on every replay of the thread. `classifyToolSettle` is the one place that
 * distinction is made, and `SettleReceipt` is the one place it is drawn.
 */

/** The literal string CopilotKit settles a never-answered interrupt with. */
const ABORT_SENTINEL = "Error: Human-in-the-loop interaction aborted";

/** The sentence `confirmPublishCountersign`'s Cancel button settles with. */
const CANCEL_SENTENCE =
  "The presenter cancelled the countersignature. Nothing was published.";

/**
 * The rendered tone, read off the `data-settle-tone` attribute `Receipt` and
 * `StatusNote` carry — the ONLY externally visible difference between "this
 * happened" and "this did not", and therefore the thing worth asserting.
 */
function tone(container: HTMLElement): string | null {
  return (
    container
      .querySelector("[data-settle-tone]")
      ?.getAttribute("data-settle-tone") ?? null
  );
}

const countersign = (result: unknown) => (
  <SettleReceipt
    result={result}
    known={EXEC_SETTLES.confirmPublishCountersign}
  />
);

describe("classifyToolSettle", () => {
  it("treats a pre-completion result as pending, not as an outcome", () => {
    expect(classifyToolSettle(undefined).kind).toBe("pending");
    expect(classifyToolSettle(null).kind).toBe("pending");
  });

  it("reads the abort sentinel as cancelled, never as an error the tool hit", () => {
    // It is not a failure of the write — the write never ran. Rendering it as
    // negative would claim a publish was attempted and rejected.
    expect(classifyToolSettle(ABORT_SENTINEL)).toEqual({
      kind: "cancelled",
      via: "abort",
      text: ABORT_SENTINEL,
    });
  });

  it("reads an empty settle as cancelled — `respond()` said nothing happened", () => {
    expect(classifyToolSettle("")).toMatchObject({ kind: "cancelled" });
    expect(classifyToolSettle("   ")).toMatchObject({ kind: "cancelled" });
  });

  it("recognises only the card's OWN cancel sentence as a choice", () => {
    expect(
      classifyToolSettle(
        CANCEL_SENTENCE,
        EXEC_SETTLES.confirmPublishCountersign,
      ),
    ).toMatchObject({ kind: "cancelled", via: "choice" });
    // Without that vocabulary the same string is just a settled sentence —
    // no render may invent a cancel it was not told about.
    expect(classifyToolSettle(CANCEL_SENTENCE)).toMatchObject({
      kind: "success",
    });
  });

  it("reads an error-prefixed relay as an error, not as a success", () => {
    expect(classifyToolSettle("Error: request failed")).toMatchObject({
      kind: "error",
    });
    // …but not a sentence that merely CONTAINS the word.
    expect(
      classifyToolSettle("Errors were cleared from the CEO dashboard."),
    ).toMatchObject({ kind: "success" });
  });

  it("reads a known failure prefix as an error", () => {
    expect(
      classifyToolSettle(
        "Could not pin that block: NOT_FOUND.",
        EXEC_SETTLES.pinBlockToDashboard,
      ),
    ).toMatchObject({ kind: "error" });
  });

  it("parses the gate refusal back out of the JSON `respond({…})` encoded", () => {
    const settle = classifyToolSettle(
      JSON.stringify({
        error: "UNEXPLAINED_VARIANCE",
        breaches: [
          {
            metric: "Operating expense",
            department: "corporate",
            period: "2024-06",
          },
        ],
      }),
    );
    expect(settle).toMatchObject({
      kind: "refusal",
      error: "UNEXPLAINED_VARIANCE",
    });
  });
});

describe("confirmPublishCountersign's settled render", () => {
  it("does NOT show a publish receipt for the abort sentinel", () => {
    // The card was never answered: nothing was countersigned and nothing was
    // published. This is the finding — today it renders as a green receipt.
    const { container } = render(countersign(ABORT_SENTINEL));
    expect(tone(container)).toBe("neutral");
    expect(screen.queryByText(/published as a board pack/)).toBeNull();
    // And the platform's internal sentinel never reaches the room.
    expect(container.textContent).not.toMatch(/Human-in-the-loop/);
    expect(container.textContent).toMatch(/nothing was published/i);
  });

  it("renders a cancelled countersign as neutral, not as a positive receipt", () => {
    const { container } = render(countersign(CANCEL_SENTENCE));
    expect(tone(container)).toBe("neutral");
    expect(container.textContent).toMatch(/cancelled/i);
  });

  it("renders a genuine success sentence as the positive receipt", () => {
    const { container } = render(
      countersign("CEO dashboard is published as a board pack."),
    );
    expect(tone(container)).toBe("positive");
    expect(
      screen.getByText(/CEO dashboard is published as a board pack/),
    ).toBeTruthy();
  });

  it("renders the 422 gate refusal with every breach listed", () => {
    const { container } = render(
      countersign(
        JSON.stringify({
          error: "UNEXPLAINED_VARIANCE",
          breaches: [
            {
              metric: "Operating expense",
              department: "manufacturing",
              period: "2024-06",
            },
            {
              metric: "Gross margin",
              department: "distribution",
              period: "2024-05",
            },
          ],
        }),
      ),
    );
    expect(tone(container)).toBe("negative");
    expect(screen.getByText(/UNEXPLAINED_VARIANCE/)).toBeTruthy();
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.textContent).toMatch(/Operating expense/);
    expect(container.textContent).toMatch(/manufacturing/);
    expect(container.textContent).toMatch(/2024-05/);
  });

  it("survives a malformed refusal body without throwing into the transcript", () => {
    // The body is whatever came back over the wire and is parsed, never
    // validated — `breaches.map(b => b.metric)` over `[null]` throws, and a
    // throw inside a transcript render takes the whole chat down mid-demo.
    const cases = [
      '{"error":"UNEXPLAINED_VARIANCE","breaches":[null,{"metric":"Opex"}]}',
      '{"error":"UNEXPLAINED_VARIANCE","breaches":{"metric":"Opex"}}',
      '{"error":"UNEXPLAINED_VARIANCE","breaches":"Opex"}',
      '{"error":"UNEXPLAINED_VARIANCE","breaches":[{}]}',
    ];
    for (const body of cases) {
      const { container, unmount } = render(countersign(body));
      expect(tone(container), body).toBe("negative");
      expect(container.textContent, body).toMatch(/UNEXPLAINED_VARIANCE/);
      unmount();
    }
  });

  it("renders nothing at all before the call completes", () => {
    const { container } = render(countersign(undefined));
    expect(container.textContent).toBe("");
  });
});

describe("pinBlockToDashboard's settled render", () => {
  const pin = (result: unknown) => (
    <SettleReceipt result={result} known={EXEC_SETTLES.pinBlockToDashboard} />
  );

  it("keeps the relayed pin failure negative", () => {
    const { container } = render(
      pin("Could not pin that block: ALREADY_PINNED — unpin it first."),
    );
    expect(tone(container)).toBe("negative");
  });

  it("does not render an error-prefixed settle as a pin that happened", () => {
    const { container } = render(pin("Error: fetch failed"));
    expect(tone(container)).toBe("negative");
    expect(container.textContent).not.toMatch(/Pinned/);
  });

  it("still renders a real pin positively", () => {
    const { container } = render(pin("Pinned to the CEO dashboard."));
    expect(tone(container)).toBe("positive");
  });
});

describe("navigateTo's settled render", () => {
  const nav = (result: unknown) => (
    <SettleReceipt result={result} known={EXEC_SETTLES.navigateTo} />
  );

  it("does not render an error-prefixed settle as a navigation that happened", () => {
    const { container } = render(nav("Error: navigation failed"));
    expect(tone(container)).toBe("negative");
    expect(container.textContent).not.toMatch(/Opened/);
  });

  it("renders a real navigation positively", () => {
    const { container } = render(nav("Opened Board packs."));
    expect(tone(container)).toBe("positive");
  });
});

describe("awaitDemonstration's settled render", () => {
  it("does not claim a demonstration was recorded when the count is unreadable", () => {
    // The count travels inside the directive because that string is all the
    // card has on replay. If it cannot be read back, NOTHING is known about
    // what was captured — asserting "Recorded the demonstration." there
    // reports an observation nobody made.
    const { container } = render(<DemonstrationSettle result="ok" />);
    expect(container.textContent).not.toMatch(/Recorded/);
    expect(tone(container)).toBe("neutral");
  });

  it("says nothing was captured when the recorder saw zero steps", () => {
    const { container } = render(
      <DemonstrationSettle
        result={
          "The presenter finished after 0 steps. Observed steps:\n(nothing captured)\n"
        }
      />,
    );
    expect(container.textContent).not.toMatch(/Recorded/);
    expect(tone(container)).toBe("neutral");
  });

  it("reports the count the RECORDER gave", () => {
    const { container } = render(
      <DemonstrationSettle
        result={
          "The presenter finished after 3 steps. Observed steps:\n1. a\n2. b\n3. c\n"
        }
      />,
    );
    expect(container.textContent).toMatch(/Recorded 3 steps/);
    expect(tone(container)).toBe("neutral");
  });

  it("reads the abort sentinel as a demonstration that never happened", () => {
    const { container } = render(
      <DemonstrationSettle result={ABORT_SENTINEL} />,
    );
    expect(container.textContent).not.toMatch(/Recorded/);
    expect(container.textContent).not.toMatch(/Human-in-the-loop/);
    expect(tone(container)).toBe("neutral");
  });

  it("never prints the directive addressed to the agent", () => {
    const { container } = render(
      <DemonstrationSettle
        result={
          "The presenter finished after 1 step. Observed steps:\n1. Filed a narrative\nThe narrative code they filed was ABC-1."
        }
      />,
    );
    expect(container.textContent).not.toMatch(/ABC-1/);
    expect(container.textContent).not.toMatch(/Observed steps/);
  });
});

describe("offerWorkflowRecording's settled render", () => {
  it("keeps an accepted offer and a declined offer distinguishable", () => {
    const accepted = render(
      <OfferSettle result="The presenter agreed to demonstrate. Call awaitDemonstration now." />,
    );
    expect(accepted.container.textContent).toMatch(/Watching you do it once/);
    accepted.unmount();

    const declined = render(
      <OfferSettle result="The presenter declined to demonstrate. Stop here." />,
    );
    expect(declined.container.textContent).toMatch(/Left it for now/);
  });

  it("does not report a DECLINE the presenter never made when the card is aborted", () => {
    // "Left it for now" is a choice. Nobody made it — the run ended.
    const { container } = render(<OfferSettle result={ABORT_SENTINEL} />);
    expect(container.textContent).not.toMatch(/Left it for now/);
    expect(container.textContent).not.toMatch(/Watching you/);
    expect(tone(container)).toBe("neutral");
  });
});

describe("saveLearnedProcedure's settled render", () => {
  it("reports a confirmation as saved and a decline as unsaved", () => {
    const saved = render(
      <SaveProcedureSettle result="The presenter confirmed. Persist this with save_memory now." />,
    );
    expect(saved.container.textContent).toMatch(/Saved/);
    saved.unmount();

    const declined = render(
      <SaveProcedureSettle result="The presenter declined to save it. Do not call save_memory." />,
    );
    expect(declined.container.textContent).toMatch(/Left it unsaved/);
  });

  it("does not claim the card was answered when the run aborted it", () => {
    const { container } = render(
      <SaveProcedureSettle result={ABORT_SENTINEL} />,
    );
    expect(container.textContent).not.toMatch(/Saved/);
    expect(container.textContent).not.toMatch(/already answered/);
    expect(tone(container)).toBe("neutral");
  });
});
