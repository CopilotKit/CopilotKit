import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { DemonstrationCard, RefundCard } from "./tools";
import { RecordingProvider } from "./components/recording-context";
import type { ReturnRequest } from "./data/types";

/**
 * BEAT 3a's card, under failure. The original version did `setSaving(true)` and
 * then awaited `onDone` bare: a rejected handler left the button reading
 * "Issuing…" forever, with the human-in-the-loop interrupt unresolved and the
 * agent run blocked behind it — and nothing on screen or in the console said so.
 * The card is the last line of defence, so it is tested independently of whether
 * its handlers keep their side of the bargain.
 *
 * No `@testing-library/jest-dom` in this app, so assertions are plain DOM.
 */
const request: ReturnRequest = {
  id: "ret-1",
  orderId: "ord-1",
  orderNumber: "BW-1041",
  customerName: "Dana Reyes",
  productId: "sku-1",
  reason: "damaged",
  detail: "Arrived scuffed.",
  requestedAt: new Date().toISOString(),
  status: "requested",
  itemValue: 120,
  refundAmount: null,
};

type OnDone = (r: ReturnRequest, amount: number) => Promise<string | null>;

function renderCard(
  overrides: {
    onDone?: OnDone;
    onCancel?: () => Promise<string | null>;
    find?: (needle: string) => ReturnRequest | undefined;
  } = {},
) {
  const onDone: OnDone = overrides.onDone ?? vi.fn(async () => null);
  const onCancel = overrides.onCancel ?? vi.fn(async () => null);
  render(
    <RefundCard
      query="Dana"
      find={overrides.find ?? (() => request)}
      productName={() => "Alder Throw"}
      onDone={onDone}
      onCancel={onCancel}
    />,
  );
  return { onDone, onCancel };
}

const button = (name: RegExp) =>
  screen.getByRole("button", { name }) as HTMLButtonElement;
const issueButton = () => button(/issue refund|issuing/i);
const alertText = () => screen.queryByRole("alert")?.textContent ?? null;
/** Every money figure in a string, so two renderings can be compared. */
const moneyIn = (text: string) => text.match(/\$[\d,.]+/g) ?? [];

/** Enter a valid goodwill figure so the submit button un-disables. */
function typeAmount(amount: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: amount } });
}

/** Click and let the handler's microtasks drain, so state settles inside act(). */
async function clickAndSettle(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RefundCard failure handling", () => {
  it("leaves its saving state and surfaces the reason when onDone REJECTS", async () => {
    const onDone = vi.fn(async () => {
      throw new Error("Failed to fetch");
    });
    renderCard({ onDone });
    typeAmount("40");
    expect(issueButton().disabled).toBe(false);

    await clickAndSettle(issueButton());

    // (a) the button came back — it is not stuck on "Issuing…"
    expect(issueButton().textContent).toBe("Issue refund");
    expect(issueButton().disabled).toBe(false);
    // (b) the failure is on screen rather than swallowed
    expect(alertText()).toContain("Failed to fetch");
    // (c) and it is retryable — the run is still waiting, so this is the user's
    //     only way forward
    await clickAndSettle(issueButton());
    expect(onDone).toHaveBeenCalledTimes(2);
  });

  it("shows the sentence a handler returns when the interrupt could not be settled", async () => {
    // What `settleInterrupt` hands back when `respond` is unavailable — a missing
    // respond must never be a silent no-op.
    const onDone: OnDone = vi.fn(
      async () => "I couldn't hand that back to the assistant. Try again.",
    );
    renderCard({ onDone });
    typeAmount("40");
    await clickAndSettle(issueButton());

    expect(alertText()).toContain("I couldn't hand that back to the assistant");
    expect(issueButton().disabled).toBe(false);
    expect(issueButton().textContent).toBe("Issue refund");
  });

  it("clears a previous failure on the next attempt", async () => {
    const onDone = vi
      .fn<OnDone>()
      .mockResolvedValueOnce("first attempt failed")
      .mockResolvedValueOnce(null);
    renderCard({ onDone });
    typeAmount("40");

    await clickAndSettle(issueButton());
    expect(alertText()).toContain("first attempt failed");

    await clickAndSettle(issueButton());
    expect(alertText()).toBeNull();
  });

  it("passes the typed figure through and shows nothing on success", async () => {
    const { onDone } = renderCard();
    typeAmount("$40.25");
    await clickAndSettle(issueButton());

    expect(onDone).toHaveBeenCalledWith(request, 40.25);
    expect(alertText()).toBeNull();
  });

  it("disables both buttons while a refund is in flight", async () => {
    let release: (() => void) | undefined;
    const onDone: OnDone = () =>
      new Promise<string | null>((resolve) => {
        release = () => resolve(null);
      });
    renderCard({ onDone });
    typeAmount("40");

    await clickAndSettle(issueButton());
    expect(issueButton().textContent).toBe("Issuing…");
    expect(issueButton().disabled).toBe(true);
    expect(button(/cancel/i).disabled).toBe(true);

    await act(async () => release?.());
    expect(issueButton().disabled).toBe(false);
  });

  it("surfaces a cancel that could not be settled, on both cancel paths", async () => {
    const onCancel = vi.fn(async () => "cancel never reached the assistant");
    renderCard({ onCancel });
    await clickAndSettle(button(/cancel/i));
    expect(alertText()).toContain("cancel never reached the assistant");

    cleanup();
    // The "no matching return" branch settles the interrupt too, and carries the
    // same obligation to say when it could not.
    renderCard({ onCancel, find: () => undefined });
    await clickAndSettle(button(/close/i));
    expect(alertText()).toContain("cancel never reached the assistant");
  });
});

/**
 * BEAT 6's waiting card had the same shape of bug: "I'm done" handed the observed
 * steps to `respond?.(…)` and returned. With `respond` unavailable that is a
 * no-op, so the teach chain stalled mid-recording with the button still inviting
 * a click that could not work.
 */
describe("DemonstrationCard failure handling", () => {
  const renderDemo = (onDone: (summary: string) => Promise<string | null>) =>
    render(
      <RecordingProvider>
        <DemonstrationCard onDone={onDone} />
      </RecordingProvider>,
    );
  const doneButton = () => button(/i.m done|saving/i);

  it("leaves its saving state and surfaces the reason when onDone REJECTS", async () => {
    const onDone = vi.fn(async () => {
      throw new Error("stream closed");
    });
    renderDemo(onDone);

    await clickAndSettle(doneButton());

    expect(doneButton().disabled).toBe(false);
    expect(doneButton().textContent).toBe("I’m done");
    expect(alertText()).toContain("stream closed");
    // Retryable: the teach chain can still be completed.
    await clickAndSettle(doneButton());
    expect(onDone).toHaveBeenCalledTimes(2);
  });

  it("shows the sentence returned when the interrupt could not be settled", async () => {
    renderDemo(async () => "I couldn't hand that back to the assistant.");
    await clickAndSettle(doneButton());

    expect(alertText()).toContain("I couldn't hand that back to the assistant");
    expect(doneButton().disabled).toBe(false);
  });

  it("reports the observed steps and stays quiet on success", async () => {
    const onDone = vi.fn<(summary: string) => Promise<string | null>>(
      async () => null,
    );
    renderDemo(onDone);
    await clickAndSettle(doneButton());

    expect(onDone).toHaveBeenCalledTimes(1);
    // The directive REPORTS the recorder's own count — nothing was logged in
    // this render, so it says so rather than leaving the card to count prose.
    expect(onDone.mock.calls[0][0]).toContain(
      "The user finished after 0 steps.",
    );
    expect(onDone.mock.calls[0][0]).toContain("(nothing captured)");
    expect(alertText()).toBeNull();
  });
});

/**
 * BEAT 3a's card, where its own INSTRUCTION meets its own rule.
 *
 * The bug: the placeholder printed `formatMoney(itemValue)` — rounded to whole
 * dollars — while the button compared the typed amount EXACTLY against
 * `itemValue`. A return charged $152.50 invited "up to $153", and typing 153 left
 * the button silently disabled. Worse than a wrong number: the operator follows
 * the app's own guidance on stage and the app refuses without saying why.
 *
 * No seeded return carries cents today (340, 96, 152, 96, 290), so this is the
 * coverage that keeps a latent defect from becoming a live one.
 */
describe("RefundCard guidance and validation agree", () => {
  const CENTS: ReturnRequest = { ...request, itemValue: 152.5 };
  const amountInput = () => screen.getByRole("textbox") as HTMLInputElement;

  it("accepts the figure its own placeholder invites", async () => {
    const { onDone } = renderCard({ find: () => CENTS });
    expect(amountInput().placeholder).toBe("up to $152.50");

    // Exactly what an operator reading that placeholder would type.
    typeAmount(amountInput().placeholder.replace(/[^0-9.]/g, ""));
    expect(issueButton().disabled).toBe(false);

    await clickAndSettle(issueButton());
    expect(onDone).toHaveBeenCalledWith(CENTS, 152.5);
    expect(alertText()).toBeNull();
  });

  it("prints ONE charged figure, and it is the placeholder's", () => {
    renderCard({ find: () => CENTS });
    const charged = screen.getByText(/^Charged/).textContent ?? "";
    expect(moneyIn(charged)).toEqual(["$152.50"]);
    expect(moneyIn(amountInput().placeholder)).toEqual(moneyIn(charged));
  });

  it("still refuses a cent over the exact ceiling", () => {
    renderCard({ find: () => CENTS });
    typeAmount("152.51");
    expect(issueButton().disabled).toBe(true);
  });
});
