/**
 * BEAT 3a — the card whose secret never enters the transcript.
 *
 * The beat is graded LIVE, in the inspector, on the AG-UI event stream: the
 * digits the passenger types must not appear in it. What that reduces to in code
 * is one property — the ONLY place the typed value travels is the request body,
 * and the string handed to `respond()` never contains it. A comment cannot hold
 * that; a `console.log` added while debugging breaks it silently and the demo
 * still looks perfect.
 *
 * ⚠️ AND THE CARD MUST NOT BECOME AN ENTITLEMENT OVERRIDE. `POST /authorizations`
 * re-runs the same `checkFareChange()` the ordinary change route runs, so a valid
 * confirmation on a non-changeable fare is still `422 FARE_NOT_CHANGEABLE`. This
 * file pins the CLIENT half of that: a refusal is SHOWN, `respond()` is never
 * called, and nothing is reported as authorized. The server half is
 * `src/app/api/airline/v1/authorizations/route.test.ts`, which walks every option
 * on all three gated bookings. If the card ever swallowed the refusal and
 * reported success, beat 6 would get a second door and NOTHING would fail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { act } from "react";
import { CardConfirmationCard } from "./card-confirmation-card";

interface Call {
  url: string;
  body: Record<string, unknown>;
}

const calls: Call[] = [];
let reply: { status: number; payload: Record<string, unknown> };

beforeEach(() => {
  calls.length = 0;
  reply = { status: 200, payload: { amountPaidUsd: 268 } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });
      return {
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        json: async () => reply.payload,
      } as unknown as Response;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = () => {
  const authorized = vi.fn();
  const declined = vi.fn();
  render(
    <CardConfirmationCard
      bookingReference="AV7702"
      flightNumber="AV7719"
      optionId="o-7702-a"
      amountDueUsd={268}
      cardLabel="Visa ending in ••••"
      onAuthorized={authorized}
      onDeclined={declined}
    />,
  );
  return { authorized, declined };
};

const field = () =>
  document.querySelector<HTMLInputElement>('input[type="password"]')!;

const buttonNamed = (text: RegExp) => {
  const el = Array.from(document.querySelectorAll("button")).find((b) =>
    text.test(b.textContent ?? ""),
  );
  expect(el, `no button matching ${text}`).toBeDefined();
  return el!;
};

const type = async (value: string) => {
  const input = field();
  await act(async () => {
    // React tracks the last value it wrote; setting `.value` directly and firing
    // `input` is the plain-DOM way to make a controlled input see a change.
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const submit = async () => {
  await act(async () => {
    buttonNamed(/Confirm/).click();
  });
};

describe("beat 3a — the digits never reach the agent", () => {
  it("POSTs them to the authorization route and nowhere else", async () => {
    const { authorized } = mount();
    await type("4417");
    await submit();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/airline/v1/authorizations");
    expect(calls[0]!.body).toEqual({
      booking: "AV7702",
      optionId: "o-7702-a",
      cardLast4: "4417",
    });

    // THE ASSERTION THE BEAT IS ACTUALLY GRADED ON. The agent receives one
    // sentence and the digits are not in it — not in the amount, not quoted
    // back, not in a "you entered …" confirmation.
    expect(authorized).toHaveBeenCalledTimes(1);
    const sentence = String(authorized.mock.calls[0]![0]);
    expect(sentence).not.toContain("4417");
    expect(sentence).toContain("AV7702");
    expect(sentence).toContain("AV7719");
    expect(sentence).toMatch(/\$268/);
    expect(sentence).toMatch(/never sent to you/i);
  });

  it("names the card by its brand and dots, which is all the ledger holds", () => {
    // `paymentCardLabel` is a brand and dots, never a number — there is no card
    // digit anywhere in this substrate, which is what lets the card name the
    // right card without putting the secret on screen. The guidance and the
    // submit predicate both come from `cardConfirmationGuidance`, so the card
    // cannot advertise a length it then refuses.
    mount();
    const text = document.body.textContent ?? "";
    expect(text).toContain("Visa ending in ••••");
    expect(text).toMatch(/Confirm the last 4 digits/i);
    expect(field().maxLength).toBe(4);
    // The field is a password input: the digits are not on the projector either.
    expect(field().type).toBe("password");
  });

  it("says why it refuses an unreadable value instead of sitting there", async () => {
    // A disabled control with nothing on screen explaining it is the failure this
    // beat's guidance names: the presenter follows the app's own instruction and
    // the card just sits there.
    const { authorized } = mount();
    await submit();
    expect(document.body.textContent).toMatch(/Enter the last four digits/i);
    expect(calls).toHaveLength(0);

    await type("-4417");
    await submit();
    // REFUSES what it cannot read rather than stripping characters:
    // `Number(typed.replace(/[^0-9]/g,""))` would turn this into a valid one.
    expect(document.body.textContent).toMatch(/numbers only/i);
    expect(calls).toHaveLength(0);

    await type("441");
    await submit();
    expect(document.body.textContent).toMatch(/that is 3 digits/i);
    expect(calls).toHaveLength(0);

    expect(authorized).not.toHaveBeenCalled();
  });
});

describe("beat 3a — a second factor, never an entitlement override", () => {
  it("shows the fare gate's own refusal and reports nothing as authorized", async () => {
    reply = {
      status: 422,
      payload: {
        error: "FARE_NOT_CHANGEABLE",
        message:
          "AV3PL9 is ticketed in Basic Economy. Changes are not permitted on this fare.",
      },
    };
    const { authorized } = mount();
    await type("4417");
    await submit();

    // The SERVER's sentence, verbatim. Replacing it with a generic "could not
    // authorize" is how a room would fail to notice that the second factor did
    // NOT override the entitlement.
    expect(document.body.textContent).toContain(
      "Changes are not permitted on this fare",
    );
    expect(authorized).not.toHaveBeenCalled();
    // …and the card is live again, not stuck mid-flight.
    expect(buttonNamed(/Confirm/).hasAttribute("disabled")).toBe(false);
  });

  it("refuses a second submission once one has been accepted", async () => {
    const { authorized } = mount();
    await type("4417");
    await submit();
    await submit();
    // A double-click must not charge twice. The settled state has its own copy
    // and its own disabled button rather than relying on the caller unmounting.
    expect(calls).toHaveLength(1);
    expect(authorized).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toMatch(/This card is finished/i);
  });

  it("reports a transport failure as 'nothing was charged', never as success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const { authorized } = mount();
    await type("4417");
    await submit();
    expect(document.body.textContent).toMatch(/Nothing was charged/i);
    expect(authorized).not.toHaveBeenCalled();
  });
});
