import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { COUNTERSIGN_PIN } from "./data/store";
import {
  COUNTERSIGN_PIN_HINT,
  DemonstrationSettle,
  EXEC_SETTLES,
  HITL_ABORTED,
  HITL_ABORT_MESSAGE,
  MetricBlockSettle,
  OfferSettle,
  PublishCountersignCard,
  SaveProcedureSettle,
  SettleReceipt,
  classifyToolSettle,
  publishRefusalPayload,
  publishSettleFor,
} from "./tools";
import type { Exception, MetricDef } from "./data/types";

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

const block = (result: unknown) => <MetricBlockSettle result={result} />;

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
    // The CODE is the agent's; the room gets a sentence — see the
    // "relays the refusal's own message" tests below.
    expect(container.textContent).not.toMatch(/UNEXPLAINED_VARIANCE/);
    expect(container.textContent).toMatch(/Publish refused/);
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
      expect(container.textContent, body).toMatch(/Publish refused/);
      unmount();
    }
  });

  it("renders nothing at all before the call completes", () => {
    // No `pendingLabel`: this render falls THROUGH to the card itself while
    // the interrupt is open, so anything drawn here would sit above it.
    const { container } = render(countersign(undefined));
    expect(container.textContent).toBe("");
  });

  it("does not say the card was never answered when it was answered with nothing", () => {
    // `respond()` / `respond(null)` settles with the EMPTY string: the card
    // WAS answered, it just reported nothing. "never answered" is the abort's
    // line and describes a different thing entirely.
    const { container } = render(countersign(""));
    expect(tone(container)).toBe("neutral");
    expect(container.textContent).not.toMatch(/never answered/i);
    expect(container.textContent).toMatch(/nothing was published/i);
  });

  it("relays the refusal's own message rather than the bare code", () => {
    // The routes and `agent.ts` both answer a coded refusal as
    // `{ error, message }`, and the message is the only half written for a
    // human. Printing `error` alone puts "Publish refused:
    // UNEXPLAINED_VARIANCE." on the screen at the climax of the demo.
    const { container } = render(
      countersign(
        JSON.stringify({
          error: "UNEXPLAINED_VARIANCE",
          message:
            "Two metrics on this dashboard breach without a filed narrative.",
        }),
      ),
    );
    expect(container.textContent).toMatch(
      /Two metrics on this dashboard breach/,
    );
    expect(container.textContent).not.toMatch(/UNEXPLAINED_VARIANCE/);
  });

  it("never prints a bare enum when the refusal carried no message", () => {
    const { container } = render(
      countersign(JSON.stringify({ error: "UNEXPLAINED_VARIANCE" })),
    );
    expect(tone(container)).toBe("negative");
    expect(container.textContent).not.toMatch(/UNEXPLAINED_VARIANCE/);
    expect(container.textContent).toMatch(/narrative/i);
  });

  it("still says something human for a code it has no phrasing for", () => {
    const { container } = render(
      countersign(JSON.stringify({ error: "SOME_NEW_GATE" })),
    );
    expect(container.textContent).not.toMatch(/SOME_NEW_GATE/);
    expect(container.textContent).toMatch(/some new gate/);
  });
});

/**
 * The hop BETWEEN the two renders above and the store: whatever `publishPack`
 * resolved with has to reach `respond()` intact, or the receipt's message arm
 * is unreachable no matter how well it renders. `EMPTY_DASHBOARD` is the
 * case that proves it — `REFUSAL_PHRASES` has no wording of its own for that
 * code, so the store's sentence IS the whole explanation, and dropping it in
 * this hop put "Publish refused: empty dashboard." on the screen instead.
 */
describe("the countersign card's refusal forwarding", () => {
  const METRIC_DEFS = [
    { id: "opex", label: "Operating expense" },
  ] as unknown as MetricDef[];

  const EMPTY_DASHBOARD_MESSAGE =
    'The "cfo" dashboard has no metric-bound block, so a board pack built ' +
    "from it would report nothing and its variance gate would check nothing.";

  it("prints the store's explanation for a code the receipt cannot word itself", () => {
    const payload = publishRefusalPayload(
      { error: "EMPTY_DASHBOARD", message: EMPTY_DASHBOARD_MESSAGE },
      METRIC_DEFS,
    );
    expect(payload.message).toBe(EMPTY_DASHBOARD_MESSAGE);

    const { container } = render(countersign(JSON.stringify(payload)));
    expect(tone(container)).toBe("negative");
    expect(container.textContent).toMatch(/no metric-bound block/);
    expect(container.textContent).not.toMatch(/EMPTY_DASHBOARD/);
    // Not the enum spelled as words either — that fallback is what having a
    // message is supposed to displace.
    expect(container.textContent).not.toMatch(/empty dashboard/);
  });

  it("carries the message alongside breaches without disturbing either", () => {
    const breaches = [
      {
        metricId: "opex",
        period: "2024-06",
        department: "manufacturing",
        variancePct: 12,
        explained: false,
      },
    ] as unknown as Exception[];
    const payload = publishRefusalPayload(
      {
        error: "UNEXPLAINED_VARIANCE",
        message: "Two metrics breach without a filed narrative.",
        breaches,
      },
      METRIC_DEFS,
    );

    const { container } = render(countersign(JSON.stringify(payload)));
    expect(container.textContent).toMatch(/Two metrics breach/);
    // The breach list is reshaped to the display trio, and the metric id is
    // resolved to its label.
    expect(payload.breaches).toEqual([
      {
        metric: "Operating expense",
        department: "manufacturing",
        period: "2024-06",
      },
    ]);
    expect(container.querySelectorAll("li")).toHaveLength(1);
  });

  it("still answers BAD_COUNTERSIGN with the code and NOTHING else", () => {
    // The PIN gate runs first precisely so a bad countersign learns nothing;
    // this hop must never grow it a body.
    // `toStrictEqual`, not `toEqual`: "and NOTHING else" is the whole claim,
    // and `toEqual` treats `{ error, message: undefined }` as equal to
    // `{ error }` — exactly the growth this guards against.
    expect(
      publishRefusalPayload({ error: "BAD_COUNTERSIGN" }, METRIC_DEFS),
    ).toStrictEqual({ error: "BAD_COUNTERSIGN" });
  });

  it("omits a message the store never sent rather than forwarding undefined", () => {
    const payload = publishRefusalPayload(
      { error: "UNEXPLAINED_VARIANCE" },
      METRIC_DEFS,
    );
    expect("message" in payload).toBe(false);
    // …and the receipt falls back to this file's own phrasing.
    const { container } = render(countersign(JSON.stringify(payload)));
    expect(container.textContent).toMatch(/narrative/i);
  });
});

/**
 * The OTHER half of that hop: what the card decides to do with each shape
 * `publishPack` can resolve with. `publishSettleFor` is the only place that
 * decision is made, so a settle that reads as a refusal over a pack that was
 * actually published is assertable here rather than only on stage.
 */
describe("the countersign card's publish decision", () => {
  const METRIC_DEFS = [
    { id: "opex", label: "Operating expense" },
  ] as unknown as MetricDef[];

  it("settles a published pack with a sentence naming the dashboard", () => {
    expect(
      publishSettleFor(
        { status: 200, published: true, pack: { id: "p1" } as never },
        "CEO Dashboard",
        METRIC_DEFS,
      ),
    ).toStrictEqual({ settle: "CEO Dashboard is published as a board pack." });
  });

  it("still settles a publish whose body did not parse as PUBLISHED", () => {
    // The 2xx says the pack is written; only its receipt was lost. Reading
    // that as a refusal put "Publish refused: publish pack succeeded but
    // returned an unreadable body" in front of the room over a pack that IS in
    // the ledger, and the agent — which reads the same settle — republished.
    const note = "The receipt could not be read, so this view may be stale.";
    const decided = publishSettleFor(
      { status: 200, published: true, note },
      "CEO Dashboard",
      METRIC_DEFS,
    );
    expect(decided).toStrictEqual({
      settle: `CEO Dashboard is published as a board pack. ${note}`,
    });
    // …and it reads as the publish it is, not as a negative receipt.
    const { container } = render(
      countersign((decided as { settle: string }).settle),
    );
    expect(tone(container)).toBe("positive");
    expect(container.textContent).not.toMatch(/refused/i);
    expect(container.textContent).toMatch(/may be stale/);
  });

  it("keeps a bad PIN on the card instead of settling the interrupt", () => {
    // EXEC_PROMPT rule 5: a typo is the presenter's to fix and the agent has
    // nothing to do with it.
    expect(
      publishSettleFor(
        { status: 403, error: "BAD_COUNTERSIGN" },
        "CEO Dashboard",
        METRIC_DEFS,
      ),
    ).toStrictEqual({
      problem:
        "That countersign PIN wasn't accepted. Nothing was published — try again.",
    });
  });

  it("settles every other refusal with the forwarded payload", () => {
    const decided = publishSettleFor(
      {
        status: 422,
        error: "UNEXPLAINED_VARIANCE",
        breaches: [
          { metricId: "opex", department: "manufacturing", period: "2024-06" },
        ] as unknown as Exception[],
      },
      "CEO Dashboard",
      METRIC_DEFS,
    );
    expect(decided).toStrictEqual({
      settle: {
        error: "UNEXPLAINED_VARIANCE",
        breaches: [
          {
            metric: "Operating expense",
            department: "manufacturing",
            period: "2024-06",
          },
        ],
      },
    });
  });
});

describe("the countersign card itself", () => {
  const card = (
    onSubmit: (id: string, pin: string) => Promise<string | null>,
  ) =>
    render(
      <PublishCountersignCard
        dashboardTitle={(id) =>
          id === "ceo" ? "CEO Dashboard" : "CFO Dashboard"
        }
        onSubmit={onSubmit as never}
        onCancel={() => {}}
      />,
    );

  const typePin = (pin: string) =>
    fireEvent.change(screen.getByLabelText("4-digit countersign PIN"), {
      target: { value: pin },
    });

  const publishButton = () =>
    screen.getByRole("button", { name: /Countersign & publish|Publishing/ });

  it("settles back out of its in-flight state when the publish SUCCEEDS", async () => {
    // The failure arm re-enabled the card and the success arm did not, so a
    // publish that worked left four disabled digits under a permanent
    // "Publishing…" — the last thing the room sees at the climax of the demo.
    let release: ((value: string | null) => void) | undefined;
    const onSubmit = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          release = resolve;
        }),
    );
    card(onSubmit);
    typePin("7341");
    fireEvent.click(publishButton());

    await waitFor(() =>
      expect(publishButton().textContent).toMatch(/Publishing/),
    );
    release!(null);

    await waitFor(() =>
      expect(publishButton().textContent).toMatch(/Countersign & publish/),
    );
    expect((publishButton() as HTMLButtonElement).disabled).toBe(false);
    // Nothing to say: the settled receipt replaces the card, and an error line
    // over a publish that worked would contradict it.
    expect(screen.queryByText(/Nothing was published/)).toBeNull();
  });

  it("re-enables the card and says why when the publish is refused", async () => {
    const onSubmit = vi.fn(() => Promise.resolve("That PIN wasn't accepted."));
    card(onSubmit);
    typePin("1111");
    fireEvent.click(publishButton());

    await screen.findByText("That PIN wasn't accepted.");
    expect((publishButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("moves focus with the selection when a dashboard is picked by mouse", () => {
    // The group is a roving-tabindex radio group: the unselected option is
    // `tabIndex={-1}`, so a click that changes the selection without moving
    // focus leaves focus on a button that is no longer a tab stop and the next
    // Tab escapes the group entirely.
    card(() => Promise.resolve(null));
    const cfo = screen.getByRole("radio", { name: "CFO Dashboard" });
    fireEvent.click(cfo);
    expect(cfo.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(cfo);
  });

  it("moves focus with the arrow keys too", () => {
    card(() => Promise.resolve(null));
    const group = screen.getByRole("radiogroup");
    fireEvent.keyDown(group, { key: "ArrowRight" });
    const cfo = screen.getByRole("radio", { name: "CFO Dashboard" });
    expect(cfo.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(cfo);
  });
});

describe("the countersign card's PIN hint", () => {
  it("is the same four digits the store validates against", () => {
    // The card hardcodes the PIN deliberately — `data/store.ts` is a SERVER
    // module and importing it into this client component would drag the whole
    // ledger into the browser bundle. A test may import it, so the
    // duplication is pinned here instead: the room is told to type a PIN, and
    // it has to be the one that works.
    expect(COUNTERSIGN_PIN_HINT).toBe(COUNTERSIGN_PIN);
    // …and the card's own `^\d{4}$` guard has to accept it.
    expect(COUNTERSIGN_PIN_HINT).toMatch(/^\d{4}$/);
  });
});

describe("render_metric_block's settled render", () => {
  it("reads METRIC_ID_REQUIRED as a refusal, never as a block that was composed", () => {
    // `agent.ts` returns this as an ordinary tool RESULT (a thrown parameter
    // error hangs the call), so without an arm of its own the shell's
    // wildcard chip ticks "Composing a block ✓" over a block that does not
    // exist.
    const { container } = render(
      block(
        JSON.stringify({
          error: "METRIC_ID_REQUIRED",
          message:
            'A "metricTile" block renders exactly one metric, so metricId is required and nothing was rendered.',
        }),
      ),
    );
    expect(tone(container)).toBe("negative");
    expect(container.textContent).toMatch(/nothing was rendered/i);
    expect(container.textContent).not.toMatch(/METRIC_ID_REQUIRED/);
  });

  it("renders ANY error-shaped result from that tool as a refusal", () => {
    // The tool's correctable-error vocabulary is still growing
    // (`UNSUPPORTED_BLOCK_PROP`-style codes naming a kind and a prop), so the
    // arm keys off the SHAPE and relays the message rather than enumerating
    // codes it would have to be kept in step with.
    const { container } = render(
      block(
        JSON.stringify({
          error: "TREND_LINE_MONTHS_UNSUPPORTED",
          message: 'A "trendLine" block has no "months" prop.',
        }),
      ),
    );
    expect(tone(container)).toBe("negative");
    expect(container.textContent).toMatch(/has no "months" prop/);
  });

  it("never prints the block's own ops payload as a receipt", () => {
    // A successful render settles with the A2UI operations that DRAW the
    // block. The block itself is the receipt; the JSON behind it is not for
    // the room.
    const { container } = render(
      block(
        JSON.stringify({
          a2ui_operations: [{ op: "add", path: "/root" }],
          blockId: "blk_1",
        }),
      ),
    );
    expect(container.textContent).not.toMatch(/a2ui_operations|blk_1/);
  });

  it("shows an in-flight line while the block is still being composed", () => {
    // Registering an exact renderer takes the tool off the shell's wildcard
    // chip, spinner included — returning null here leaves the room watching
    // nothing at all happen.
    const { container } = render(block(undefined));
    expect(container.textContent).toMatch(/Composing a block/);
  });
});

describe("the platform abort sentinel this file reconstructs", () => {
  /**
   * `HITL_ABORTED` is spelled out here because NEITHER half is exported: the
   * message comes from `@copilotkit/react-core`'s v2
   * `use-human-in-the-loop.tsx`, and the `Error: ` prefix from
   * `@copilotkit/core`'s `CopilotKitCore.executeToolHandler`. These tests read
   * the INSTALLED packages so an upstream reword fails here — loudly, naming
   * the file to look in — instead of silently turning every aborted card back
   * into a green receipt.
   */
  // Plain path joining, NOT `new URL(…, import.meta.url)`: vite rewrites that
  // pattern at build time as an asset reference, which resolves to an
  // http://localhost URL under `.pnpm/` (or to "undefined" when the argument
  // is interpolated) rather than to a readable path.
  const distOf = (pkg: string) =>
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../node_modules/@copilotkit",
      pkg,
      "dist",
    );

  it("classifies the exact string CopilotKit settles an aborted card with", () => {
    expect(classifyToolSettle(HITL_ABORTED)).toMatchObject({
      kind: "cancelled",
      via: "abort",
    });
  });

  it("still recognises the abort when the platform wraps its own message", () => {
    // Matched by CONTAINMENT, not by prefix: the prefix is upstream's and has
    // already changed shape once. A wrapped sentinel read as a plain error
    // reports a write that was attempted and rejected — nothing ran at all.
    expect(
      classifyToolSettle(`Error: Tool call failed: ${HITL_ABORT_MESSAGE}`),
    ).toMatchObject({ kind: "cancelled", via: "abort" });
  });

  it("fails if @copilotkit/react-core rewords the abort message", () => {
    const dir = distOf("react-core");
    const bundles = readdirSync(dir).filter((f) => f.endsWith(".mjs"));
    const found = bundles.some((f) =>
      readFileSync(join(dir, f), "utf8").includes(HITL_ABORT_MESSAGE),
    );
    expect(
      found,
      `"${HITL_ABORT_MESSAGE}" is no longer in @copilotkit/react-core's bundles — ` +
        "re-read v2 use-human-in-the-loop.tsx and update HITL_ABORT_MESSAGE.",
    ).toBe(true);
  });

  it("fails if @copilotkit/core rewords the `Error: ` prefix it wraps a rejection in", () => {
    // Scanned across the dist bundles the same way its sibling above is, NOT
    // read from a hardcoded `index.mjs`: an upstream rename of the entrypoint
    // threw a bare ENOENT that named a path and not the thing being guarded,
    // which is the one moment this test has to explain itself.
    const dir = distOf("core");
    const bundles = readdirSync(dir).filter((f) => f.endsWith(".mjs"));
    const found = bundles.some((f) =>
      readFileSync(join(dir, f), "utf8").includes(
        "toolCallResult = `Error: ${errorMessage}`",
      ),
    );
    expect(
      found,
      "CopilotKitCore.executeToolHandler no longer prefixes a rejected tool " +
        "handler with `Error: ` — re-read it and update HITL_ABORTED.",
    ).toBe(true);
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
