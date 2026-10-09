import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { SigningPinCard } from "@/skins/keel/components/signing-pin-card";

/**
 * BEAT 3a — the two claims the card makes, and the one it must never make.
 *
 *  1. The PIN reaches the REQUEST and nothing else. Not `onSigned` (which is the
 *     agent's `respond()`), not the confirmation copy, nowhere the transcript can
 *     reach. Every assertion below therefore checks the digits against the whole
 *     string handed back, not just against a field.
 *
 *  2. A refusal is RELAYED, never routed around. `/countersignatures` re-runs the
 *     same `checkReleaseAuthority()` gate as the ordinary release route, so a
 *     valid PIN on an UNENDORSED revision is refused — and this card's job is to
 *     say so. If it ever grew a second path (a "release anyway", a different
 *     endpoint, a retry that drops the gate) beat 6 would have a second door, the
 *     agent would take it, the teach arc would never fire, and NOTHING would
 *     fail: the write lands, the card looks perfect, the room applauds. That is
 *     why this is a test and not a comment.
 */

const PIN = "482913";
const DOC = "STD-045";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const stubFetch = (response: {
  ok: boolean;
  status?: number;
  body?: unknown;
}) => {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve({
        ok: response.ok,
        status: response.status ?? (response.ok ? 200 : 403),
        json: () => Promise.resolve(response.body ?? {}),
      });
    }),
  );
  return calls;
};

const type = (value: string) =>
  fireEvent.change(screen.getByLabelText("E-signature PIN"), {
    target: { value },
  });

/**
 * Click Countersign and let the card's async submit settle inside `act`.
 * `fireEvent` wraps the click itself, but the state written after the awaited
 * fetch resolves lands outside it — which React reports as an act() warning and
 * which, unwrapped, makes the assertions race the component.
 */
const submit = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /countersign/i }));
  });
};

describe("SigningPinCard — where the PIN travels", () => {
  it("sends the PIN in the request body and NOTHING else learns it", async () => {
    const calls = stubFetch({ ok: true, body: { via: "endorsed" } });
    const onSigned = vi.fn();
    render(
      <SigningPinCard
        documentRef={DOC}
        revisionLabel="Rev B"
        personaId="sam-okafor"
        onSigned={onSigned}
        onDeclined={() => {}}
      />,
    );

    type(PIN);
    await submit();
    expect(onSigned).toHaveBeenCalled();

    // The one place the digits appear.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/keel/v1/countersignatures");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({
      document: DOC,
      pin: PIN,
      personaId: "sam-okafor",
    });

    // The agent's `respond()` payload, in full. The PIN must not be anywhere in
    // it — checked against the whole string, because a leak through an
    // interpolation would not live in a named field.
    const relayed = String(onSigned.mock.calls[0][0]);
    expect(relayed).not.toContain(PIN);
    expect(relayed).toContain("Rev B");
    expect(relayed).toContain(DOC);
    expect(relayed).toContain("never sent to you");
  });

  it("never sends anything for a PIN of the wrong shape, and says why", async () => {
    const calls = stubFetch({ ok: true });
    const onSigned = vi.fn();
    render(
      <SigningPinCard
        documentRef={DOC}
        revisionLabel="Rev B"
        personaId="sam-okafor"
        onSigned={onSigned}
        onDeclined={() => {}}
      />,
    );

    type("12");
    await submit();

    // No request, and the reason is ON SCREEN rather than the button silently
    // doing nothing — the failure a disabled control with no explanation causes.
    expect(calls).toHaveLength(0);
    expect(onSigned).not.toHaveBeenCalled();
    expect(screen.getByText(/exactly 6 digits/i)).toBeTruthy();
  });

  it("tells the operator to enter a PIN rather than sitting there", async () => {
    const calls = stubFetch({ ok: true });
    render(
      <SigningPinCard
        documentRef={DOC}
        revisionLabel="Rev B"
        personaId="sam-okafor"
        onSigned={() => {}}
        onDeclined={() => {}}
      />,
    );

    await submit();
    expect(calls).toHaveLength(0);
    expect(screen.getByText(/Enter your e-signature PIN/i)).toBeTruthy();
  });
});

describe("SigningPinCard is NOT a way past the release gate", () => {
  /**
   * The server refuses an unendorsed revision with `UNENDORSED_REVISION` even for
   * a well-formed PIN. The card must surface that verdict and make exactly ONE
   * request — no second attempt, no alternative endpoint.
   */
  it("relays UNENDORSED_REVISION and issues no second request", async () => {
    const message =
      "Rev D of POL-114 has not been endorsed by the Policy Governance Committee. " +
      "It cannot be released to the workforce.";
    const calls = stubFetch({
      ok: false,
      status: 403,
      body: { error: "UNENDORSED_REVISION", message },
    });
    const onSigned = vi.fn();
    render(
      <SigningPinCard
        documentRef="POL-114"
        revisionLabel="Rev D"
        personaId="sam-okafor"
        onSigned={onSigned}
        onDeclined={() => {}}
      />,
    );

    type(PIN);
    await submit();
    expect(onSigned).toHaveBeenCalled();

    // ONE request, to the ONE endpoint. A card that retried, or fell back to
    // `/documents/:id/release`, would be the second door.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/keel/v1/countersignatures");

    // The refusal reaches both the operator and the agent, verbatim.
    expect(screen.getByText(message)).toBeTruthy();
    const relayed = String(onSigned.mock.calls[0][0]);
    expect(relayed).toContain("refused");
    expect(relayed).toContain("Policy Governance Committee");
    expect(relayed).not.toContain("is released");
    // And still no digits, on the failure path too.
    expect(relayed).not.toContain(PIN);
  });

  it("says 'not accepted' for a rejected PIN without echoing what was typed", async () => {
    stubFetch({
      ok: false,
      status: 401,
      body: {
        error: "INVALID_PIN",
        message: "That e-signature PIN was not accepted.",
      },
    });
    const onSigned = vi.fn();
    render(
      <SigningPinCard
        documentRef={DOC}
        revisionLabel="Rev B"
        personaId="sam-okafor"
        onSigned={onSigned}
        onDeclined={() => {}}
      />,
    );

    type(PIN);
    await submit();
    expect(onSigned).toHaveBeenCalled();

    expect(screen.getByText(/was not accepted/i)).toBeTruthy();
    expect(document.body.textContent).not.toContain(PIN);
    expect(String(onSigned.mock.calls[0][0])).not.toContain(PIN);
  });

  it("releases nothing when the operator cancels", () => {
    const calls = stubFetch({ ok: true });
    const onDeclined = vi.fn();
    render(
      <SigningPinCard
        documentRef={DOC}
        revisionLabel="Rev B"
        personaId="sam-okafor"
        onSigned={() => {}}
        onDeclined={onDeclined}
      />,
    );

    type(PIN);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(calls).toHaveLength(0);
    expect(onDeclined).toHaveBeenCalled();
  });
});
