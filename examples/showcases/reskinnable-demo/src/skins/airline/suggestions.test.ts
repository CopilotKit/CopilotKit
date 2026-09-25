/**
 * The pills are the demo's script. Two things about them break silently.
 *
 *  1. **The beat-3d pill's message must be the CONSTANT.** `skin.tsx`'s
 *     `onSuggestionSelect` matches on that exact value to intercept the click and
 *     drive the real composer, because the framework's suggestion path DROPS
 *     attachments. A retyped-and-drifted sentence takes the default send path: the
 *     prompt goes without the hotel confirmation, the agent correctly invents
 *     nothing, and beat 3d fails looking like a model problem.
 *  2. **Beat 4 must come before beat 5.** Beat 5 resolves the cancelled return by
 *     rebooking it, and beat 4's seeded preference says "lead with whatever is
 *     disrupted". Running them the other way round removes the disruption beat 4 is
 *     supposed to lead with — a demo defect no type or lint rule can see.
 */
import { describe, expect, it, vi } from "vitest";

/**
 * PARTIAL mock: the CONSTANT stays real, because comparing the pill against a fake
 * one would prove nothing about the value `onSuggestionSelect` matches on. Only the
 * two senders are stubbed — the real `sendHotelConfirmationMessage` hunts for the
 * live chat composer, fails (correctly, there is none in jsdom) and reports through
 * `window.alert`, which jsdom does not implement.
 */
vi.mock("./attach-hotel-confirmation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./attach-hotel-confirmation")>()),
  sendHotelConfirmationMessage: vi.fn(() => Promise.resolve(true)),
  attachHotelConfirmationByHand: vi.fn(() => Promise.resolve(true)),
}));

import {
  HOTEL_CONFIRMATION_MESSAGE,
  sendHotelConfirmationMessage,
} from "./attach-hotel-confirmation";
import airline from "./skin";
import { airlineSuggestions } from "./suggestions";

const messages = airlineSuggestions.map((s) => s.message);
const index = (needle: string) =>
  messages.findIndex((m) => m.toLowerCase().includes(needle.toLowerCase()));

describe("airline suggestion pills", () => {
  it("ships one pill per beat, and the skin registers exactly these", () => {
    // Nine beats, eight pills: beat 2 is demonstrated by RELOADING, not by asking.
    expect(airlineSuggestions).toHaveLength(8);
    expect(airline.suggestions).toBe(airlineSuggestions);
    for (const pill of airlineSuggestions) {
      expect(pill.title.length).toBeGreaterThan(0);
      expect(pill.message.length).toBeGreaterThan(0);
    }
    // No duplicate messages — two pills sending the same text is one dead pill.
    expect(new Set(messages).size).toBe(messages.length);
  });

  it("carries the beat-3d message as the imported CONSTANT", () => {
    // Identity, not similarity: `onSuggestionSelect` compares with `!==`.
    expect(messages).toContain(HOTEL_CONFIRMATION_MESSAGE);
    // …and the skin's interceptor claims exactly that pill and no other.
    const pill = airlineSuggestions.find(
      (s) => s.message === HOTEL_CONFIRMATION_MESSAGE,
    );
    expect(pill).toBeDefined();
    expect(airline.onSuggestionSelect?.(pill!, 0)).toBe(true);
    // `true` means "the shell must not run its default send", so the skin has to
    // have taken over the send itself. Claiming the click without sending anything
    // is the one outcome worse than not intercepting.
    expect(sendHotelConfirmationMessage).toHaveBeenCalledTimes(1);
    for (const other of airlineSuggestions.filter((s) => s !== pill)) {
      expect(
        airline.onSuggestionSelect?.(other, 0),
        `"${other.title}" is being intercepted, so its message never sends`,
      ).toBe(false);
    }
  });

  it("orders beat 4 before beat 5, and beat 6 last", () => {
    const beat4 = index("summarize my trips");
    const beat5 = index("just got cancelled");
    const beat6 = index("Tomás");
    expect(beat4).toBeGreaterThanOrEqual(0);
    expect(beat5).toBeGreaterThanOrEqual(0);
    expect(beat6).toBeGreaterThanOrEqual(0);
    // Beat 5 rebooks the cancelled return that beat 4 leads with.
    expect(beat4).toBeLessThan(beat5);
    // Beat 6 is the finale: the room has to watch the concierge succeed at
    // everything else before it is shown failing.
    expect(beat6).toBe(airlineSuggestions.length - 1);
  });

  it("names beat 3c's four levers and its limit, so one click sets all of them", () => {
    // A single filter reads as a link with extra steps. The request has to IMPLY
    // several levers at once for the beat to land.
    const pill = messages[index("evening nonstops")];
    expect(pill).toMatch(/evening/i); // window
    expect(pill).toMatch(/nonstop/i); // stops
    expect(pill).toMatch(/cheapest/i); // sort
    expect(pill).toMatch(/top 5/i); // limit
  });

  it("keeps beat 6's target off beat 3a's and beat 5's records", () => {
    // One booking carrying three beats is how a presenter ends up demonstrating the
    // wrong one. Beat 6 names Tomás's AV3PL9; beat 3a is Camila's Buenos Aires Flex
    // trip; beat 5 is her cancelled flight home.
    expect(messages[index("Tomás")]).toMatch(/AV3PL9/);
    expect(messages[index("Buenos Aires")]).not.toMatch(/AV3PL9/);
    expect(messages[index("just got cancelled")]).not.toMatch(/AV3PL9/);
  });

  it("keeps beat 5's trigger VAGUE, which is the whole claim", () => {
    // If the pill recited the three steps it would prove nothing about stored
    // procedures. It must name no tool and no action.
    const pill = messages[index("just got cancelled")];
    expect(pill).toMatch(/handle it/i);
    for (const named of ["rebook", "reseat", "notify", "seat", "text"]) {
      expect(pill.toLowerCase()).not.toContain(named);
    }
  });
});
