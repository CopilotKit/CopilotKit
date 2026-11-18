/**
 * BEAT 6 — the operator filing form's RECORDING contract, and its role as the
 * SIXTH channel.
 *
 * The shell's `recording.test.tsx` proves the state machine in isolation and
 * `../teach-mode-directives.test.ts` proves the directives. Neither can prove the
 * thing that actually breaks here: that THIS form calls into the recorder in the
 * right order, and that the code it files is the code `getDemonstratedCode()` hands
 * to the chat. Every failure mode is SILENT — `logStep` early-returns while idle,
 * `useRecording` returns inert no-ops outside a provider — so a broken form still
 * renders, still files, and is discovered on stage with an empty feed and no code.
 *
 * The outer bracket is simulated deliberately. In the app `./demonstration-card.tsx`
 * holds `beginRecording()` open from "show me" to "I'm done"; the form's own
 * brackets nest inside it. That nesting is what keeps the feed alive across the TWO
 * clicks a demonstration takes (file, then release), so the test opens an outer
 * bracket the same way rather than relying on the shell's minimum-visible hold to
 * paper over a gap.
 */
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { RecordingProvider, useRecording } from "@/shell/teach";
import type { DocumentRecord, KeelLedger, Variance } from "../data/types";
import { KEEL_PERSONAS } from "../data/personas";
import { VARIANCE_CODES, VARIANCE_CODE_LABELS } from "../data/variance-codes";

const ledger = {
  documents: [] as DocumentRecord[],
  variances: [] as Variance[],
};
const refresh = vi.fn().mockResolvedValue(true);

vi.mock("@/skins/keel/ledger-context", () => ({
  useKeelLedger: () => ({
    data: {
      documents: ledger.documents,
      variances: ledger.variances,
      runs: [],
      playbooks: [],
      personas: [],
      impactBriefs: [],
      asOf: "2026-08-12T00:00:00.000Z",
    } as KeelLedger,
    refresh,
    ready: true,
  }),
}));

import { VarianceFilingForm } from "./variance-form";

/** A revision awaiting release that the Policy Governance Committee has not signed. */
const gated = (over: Partial<DocumentRecord> = {}): DocumentRecord => ({
  docId: "phi-access-policy",
  ref: "POL-114",
  title: "PHI Access & Minimum Necessary",
  space: "privacy",
  owner: "Privacy Office",
  status: "published",
  effectiveRevision: "Rev C",
  lastReviewed: "2025-06-01",
  reviewDue: "2026-01-01",
  attestation: { assigned: 100, completed: 90 },
  pendingRevision: {
    label: "Rev D",
    stage: "draft",
    summary: "Tightens the minimum-necessary review cadence.",
    authoredBy: "Sam Okafor",
    requiredEndorsements: [{ body: "Policy Governance Committee" }],
  },
  ...over,
});

/**
 * Stands in for the chat's `DemonstrationCard`: opens the outer bracket on mount
 * and reports the live feed plus the derived code out to the assertions.
 */
function Recorder({
  report,
}: {
  report: (state: { labels: string[]; code: string | null }) => void;
}) {
  const { beginRecording, endRecording, steps, getDemonstratedCode } =
    useRecording();
  useEffect(() => {
    beginRecording();
    return () => endRecording();
  }, [beginRecording, endRecording]);
  report({ labels: steps.map((s) => s.label), code: getDemonstratedCode() });
  return null;
}

const mount = () => {
  let state = { labels: [] as string[], code: null as string | null };
  render(
    <RecordingProvider>
      <Recorder report={(s) => (state = s)} />
      <VarianceFilingForm />
    </RecordingProvider>,
  );
  return () => state;
};

const pickCode = (code: string) =>
  fireEvent.change(screen.getByLabelText("Variance code"), {
    target: { value: code },
  });

/**
 * The file-and-ratify pair plus the release, in call order. `fetch` is stubbed
 * rather than a desk helper mocked because this form POSTs through its own fetch —
 * the pattern keel's e-signature card and `fileImpactBrief` already use.
 */
const stubFetch = (opts: { releaseOk: boolean }) => {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (url === "/api/keel/v1/variances") {
        return new Response(JSON.stringify({ id: "var-1" }), { status: 201 });
      }
      if (url.endsWith("/ratify")) {
        return new Response(
          JSON.stringify({ id: "var-1", status: "ratified" }),
          {
            status: 200,
          },
        );
      }
      if (url.endsWith("/release")) {
        return opts.releaseOk
          ? new Response(JSON.stringify({ record: {}, via: "variance" }), {
              status: 200,
            })
          : new Response(
              JSON.stringify({
                error: "UNENDORSED_REVISION",
                message:
                  "Rev D of POL-114 has not been endorsed by the Policy Governance Committee. It cannot be released to the workforce.",
              }),
              { status: 403 },
            );
      }
      return new Response("{}", { status: 200 });
    }),
  );
  return calls;
};

afterEach(() => {
  cleanup();
  ledger.documents = [];
  ledger.variances = [];
  refresh.mockClear();
  vi.unstubAllGlobals();
});

describe("the menu is undifferentiated, which is the whole beat", () => {
  it("lists every code — justifying and decoy — in catalogue order, unmarked", () => {
    // A form that flagged the working codes would make the demonstration a guided
    // tour: the operator would be following an instruction the app gave them rather
    // than exercising knowledge only they have.
    ledger.documents = [gated()];
    mount();
    const options = [
      ...screen.getByLabelText("Variance code").querySelectorAll("option"),
    ];
    expect(options.map((o) => o.getAttribute("value"))).toEqual([
      ...VARIANCE_CODES,
    ]);
    expect(options.map((o) => o.textContent)).toEqual(
      VARIANCE_CODES.map((c) => VARIANCE_CODE_LABELS[c]),
    );
  });

  it("offers only revisions the release gate would actually refuse", () => {
    // Derived through the same `checkReleaseAuthority` the ROUTE runs, so the form
    // cannot advertise a case the gate would allow — nor hide one it would refuse.
    const clear = gated({
      docId: "third-party-risk",
      ref: "STD-045",
      pendingRevision: {
        label: "Rev B",
        stage: "endorsed",
        summary: "s",
        authoredBy: "x",
        requiredEndorsements: [
          { body: "Policy Governance Committee", endorsedAt: "2026-07-01" },
        ],
      },
    });
    ledger.documents = [gated(), clear];
    mount();
    const options = [
      ...screen
        .getByLabelText("Revision needing a variance")
        .querySelectorAll("option"),
    ];
    expect(options.map((o) => o.getAttribute("value"))).toEqual([
      "phi-access-policy",
    ]);
  });

  it("says so plainly when nothing needs a variance, rather than rendering an empty select", () => {
    mount();
    expect(
      screen.getByText(/Every revision awaiting release is fully endorsed/),
    ).toBeTruthy();
  });
});

describe("the recording contract", () => {
  it("records the filed code as DATA on the step that files it", async () => {
    ledger.documents = [gated()];
    const calls = stubFetch({ releaseOk: true });
    const state = mount();

    pickCode("PATIENT_SAFETY_ALERT");
    fireEvent.click(screen.getByRole("button", { name: "File variance" }));

    await waitFor(() =>
      expect(state().labels).toEqual([
        "Opened the variance form on POL-114 Rev D",
        "Filed the publication variance as PATIENT_SAFETY_ALERT",
      ]),
    );
    // The whole hand-off to the chat: `getDemonstratedCode()` reads the last CODED
    // step, so the filing step must CARRY the code rather than merely mention it in
    // its prose.
    expect(state().code).toBe("PATIENT_SAFETY_ALERT");
    // FILED AND RATIFIED in one click — a draft variance authorizes nothing, so a
    // form that stopped at the draft would demonstrate half a procedure.
    expect(calls.map((c) => c.url)).toEqual([
      "/api/keel/v1/variances",
      "/api/keel/v1/variances/var-1/ratify",
    ]);
    expect(calls[0].body).toMatchObject({
      docId: "phi-access-policy",
      code: "PATIENT_SAFETY_ALERT",
      // DERIVED from the role context, never typed into the form: the register
      // records who filed it.
      personaId: KEEL_PERSONAS[0].id,
    });
  });

  it("records the DECOY the operator actually filed, not a corrected one", async () => {
    // A recorder that quietly substituted a working code would report a procedure
    // nobody demonstrated — and the release below would still be blocked, so the
    // transcript and the app would disagree on stage. Watching a ratified
    // COMMITTEE_CALENDAR leave the release blocked is the demonstration WORKING.
    ledger.documents = [gated()];
    stubFetch({ releaseOk: false });
    const state = mount();

    pickCode("COMMITTEE_CALENDAR");
    fireEvent.click(screen.getByRole("button", { name: "File variance" }));
    await waitFor(() => expect(state().code).toBe("COMMITTEE_CALENDAR"));

    fireEvent.click(screen.getByRole("button", { name: /^Release Rev D/ }));
    await waitFor(() =>
      expect(state().labels).toEqual([
        "Opened the variance form on POL-114 Rev D",
        "Filed the publication variance as COMMITTEE_CALENDAR",
        "Re-attempted the release of POL-114 Rev D — still blocked",
      ]),
    );
    expect(state().code).toBe("COMMITTEE_CALENDAR");
    // The server's own refusal, surfaced rather than swallowed.
    expect(document.querySelector("p.text-negative")?.textContent).toContain(
      "has not been endorsed by the Policy Governance Committee",
    );
  });

  it("keeps ONE continuous feed across the file and release clicks", async () => {
    // The two clicks are two nested brackets. If the outer one were missing the ref
    // count would touch zero between them; the shell's minimum-visible hold hides
    // that most of the time and would not on a slow stage machine — and the stranded
    // code is exactly what the chat card needs.
    ledger.documents = [gated()];
    stubFetch({ releaseOk: true });
    const state = mount();

    pickCode("REGULATORY_MANDATE");
    fireEvent.click(screen.getByRole("button", { name: "File variance" }));
    await waitFor(() => expect(state().labels).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: /^Release Rev D/ }));

    await waitFor(() =>
      expect(state().labels).toEqual([
        "Opened the variance form on POL-114 Rev D",
        "Filed the publication variance as REGULATORY_MANDATE",
        "Released Rev D of POL-114 to the workforce — the block lifted",
      ]),
    );
    expect(state().code).toBe("REGULATORY_MANDATE");
  });

  it("narrates a REFUSED filing into the feed rather than failing silently", async () => {
    // A silent failure would let the watching agent conclude the step succeeded, and
    // it would then save a procedure whose first step never worked.
    ledger.documents = [gated()];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: "UNKNOWN_VARIANCE_CODE",
              message:
                '"WHATEVER" is not a recognized publication-variance code.',
            }),
            { status: 422 },
          ),
      ),
    );
    const state = mount();

    fireEvent.click(screen.getByRole("button", { name: "File variance" }));

    await waitFor(() =>
      expect(state().labels).toEqual([
        "Opened the variance form on POL-114 Rev D",
        "The variance was refused on POL-114",
      ]),
    );
    // No coded step, so nothing is handed to the chat as a demonstrated code.
    expect(state().code).toBeNull();
  });

  it("keeps the release button disabled until a variance is ratified for THAT document", () => {
    ledger.documents = [gated()];
    mount();
    expect(
      screen.getByRole("button", { name: /^Release Rev D/ }),
    ).toHaveProperty("disabled", true);
  });
});
