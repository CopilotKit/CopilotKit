/**
 * BEAT 6 — the planner filing form's RECORDING contract.
 *
 * The shell's `recording.test.tsx` proves the state machine in isolation and
 * `../teach-mode-directives.test.ts` proves the directives. Neither can prove
 * the thing that actually breaks here: that THIS form calls into the recorder in
 * the right order, and that the code it files is the code
 * `getDemonstratedCode()` hands to the chat. Every failure mode is silent —
 * `logStep` early-returns while idle, `useRecording` returns inert no-ops outside
 * a provider — so a broken form still renders, still files, and is discovered on
 * stage with an empty feed and no code.
 *
 * The outer bracket is simulated deliberately. In the app the chat's
 * `DemonstrationCard` holds `beginRecording()` open from "show me" to "I'm done";
 * the form's own brackets nest inside it. That nesting is what keeps the feed
 * alive across the TWO clicks a demonstration takes (file, then release), so the
 * test opens an outer bracket the same way rather than relying on the shell's
 * minimum-visible hold to paper over a gap.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { useEffect } from "react";
import { RecordingProvider, useRecording } from "@/shell/teach";
import type { Lane, Planner, Shipment } from "../data/types";

const ledger = {
  shipments: [] as Shipment[],
  lanes: [] as Lane[],
  fileEscalation: vi.fn(),
  commitMitigation: vi.fn(),
};
vi.mock("../actions", () => ({ useLogistics: () => ledger }));

const planner = { current: null as Planner | null };
vi.mock("./planner-auth-context", () => ({
  usePlannerAuth: () => ({
    currentPlanner: planner.current,
    plannerId: planner.current?.id ?? "",
    setPlannerId: () => {},
    planners: [],
    ready: true,
  }),
}));

import { EscalationFilingForm } from "./escalation-form";

const ROSA: Planner = {
  id: "pl-rosa",
  name: "Rosa Delgado",
  role: "Planner",
  region: "Trans-Pacific",
  authorityUsd: 5000,
};

const DIRECTOR: Planner = {
  id: "pl-ibrahim",
  name: "Ibrahim Okonjo",
  role: "Director",
  region: "Global",
  authorityUsd: null,
};

/**
 * One ocean lane plus one air lane to the same destination, which is what makes
 * `computeMitigationOptions` produce an `expedite` — the only option here that
 * lands over Rosa's cap. 1000 kg at $6/kg = $6,000.
 */
const LANES: Lane[] = [
  {
    id: "ln-ocean",
    origin: "Shanghai (SHA)",
    destination: "Los Angeles (LAX)",
    mode: "ocean",
    transitDays: 24,
    reliability: 0.7,
    costPerKg: 0.45,
    status: "degraded",
  },
  {
    id: "ln-air",
    origin: "Shanghai (SHA)",
    destination: "Los Angeles (LAX)",
    mode: "air",
    transitDays: 2,
    reliability: 0.94,
    costPerKg: 6,
    status: "healthy",
  },
];

const shipment = (reference: string): Shipment => ({
  id: `shp-${reference}`,
  reference,
  laneId: "ln-ocean",
  carrier: "Pacific Star Line",
  skuId: "sku-1",
  units: 100,
  weightKg: 1000,
  valueUsd: 200000,
  etaPlanned: "2026-08-06",
  etaCurrent: "2026-08-12",
  slaDate: "2026-08-08",
  status: "delayed",
  exception: { code: "PORT_CONGESTION", detail: "Berth queue", since: "x" },
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
      <EscalationFilingForm />
    </RecordingProvider>,
  );
  return () => state;
};

const pickCode = (code: string) =>
  fireEvent.change(screen.getByLabelText("Escalation code"), {
    target: { value: code },
  });

afterEach(() => {
  cleanup();
  ledger.shipments = [];
  ledger.lanes = [];
  ledger.fileEscalation.mockReset();
  ledger.commitMitigation.mockReset();
  planner.current = null;
});

describe("logistics beat 6 — the planner filing form", () => {
  it("records the filed code as DATA on the step that files it", async () => {
    planner.current = ROSA;
    ledger.lanes = LANES;
    ledger.shipments = [shipment("PO-88213")];
    ledger.fileEscalation.mockResolvedValue({ ok: true });
    const state = mount();

    pickCode("CUSTOMER_COMMITMENT");
    fireEvent.click(screen.getByRole("button", { name: "File escalation" }));

    await waitFor(() =>
      expect(state().labels).toEqual([
        "Opened the escalation form on PO-88213",
        "Filed the escalation as CUSTOMER_COMMITMENT",
      ]),
    );
    // The whole hand-off to the chat: `getDemonstratedCode()` reads the last
    // CODED step, so the filing step must carry the code rather than merely
    // mention it in prose.
    expect(state().code).toBe("CUSTOMER_COMMITMENT");
    expect(ledger.fileEscalation).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CUSTOMER_COMMITMENT" }),
    );
  });

  it("records the DECOY the planner actually filed, not a corrected one", async () => {
    // A recorder that quietly substituted a working code would report a
    // procedure nobody demonstrated — and the release below would still be
    // blocked, so the transcript and the app would disagree on stage.
    planner.current = ROSA;
    ledger.lanes = LANES;
    ledger.shipments = [shipment("PO-88213")];
    ledger.fileEscalation.mockResolvedValue({ ok: true });
    ledger.commitMitigation.mockResolvedValue({
      ok: false,
      error:
        "This mitigation costs $6,000, above your $5,000 approval authority.",
    });
    const state = mount();

    pickCode("PEAK_SEASON");
    fireEvent.click(screen.getByRole("button", { name: "File escalation" }));
    await waitFor(() => expect(state().code).toBe("PEAK_SEASON"));

    fireEvent.click(screen.getByRole("button", { name: /^Release the/ }));
    await waitFor(() =>
      expect(state().labels).toEqual([
        "Opened the escalation form on PO-88213",
        "Filed the escalation as PEAK_SEASON",
        "Re-attempted the expedite on PO-88213 — still blocked",
      ]),
    );
    // Still the filed code: the demonstration is what it is, and the chat card
    // must be able to report the decoy the planner chose.
    expect(state().code).toBe("PEAK_SEASON");
    // The server's own refusal, surfaced on the form's note line rather than
    // swallowed — scoped to that line because the panel's header states the same
    // cost and cap as a description of the block.
    expect(document.querySelector("p.text-negative")?.textContent).toContain(
      "above your $5,000 approval authority",
    );
  });

  it("keeps ONE continuous feed across the file and release clicks", async () => {
    // The two clicks are two nested brackets. If the outer one were missing the
    // ref count would touch zero between them; the shell's minimum-visible hold
    // hides that most of the time and would not on a slow stage machine.
    planner.current = ROSA;
    ledger.lanes = LANES;
    ledger.shipments = [shipment("PO-88213")];
    ledger.fileEscalation.mockResolvedValue({ ok: true });
    ledger.commitMitigation.mockResolvedValue({ ok: true });
    const state = mount();

    pickCode("LINE_DOWN_RISK");
    fireEvent.click(screen.getByRole("button", { name: "File escalation" }));
    await waitFor(() => expect(state().labels).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: /^Release the/ }));

    await waitFor(() =>
      expect(state().labels).toEqual([
        "Opened the escalation form on PO-88213",
        "Filed the escalation as LINE_DOWN_RISK",
        "Released the expedite on PO-88213 — the block lifted",
      ]),
    );
    expect(state().code).toBe("LINE_DOWN_RISK");
    expect(ledger.commitMitigation).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "expedite" }),
    );
  });

  it("narrates a refused filing instead of failing silently", async () => {
    planner.current = ROSA;
    ledger.lanes = LANES;
    ledger.shipments = [shipment("PO-88213")];
    ledger.fileEscalation.mockResolvedValue({
      ok: false,
      error: '"NOPE" is not a recognized escalation code.',
    });
    const state = mount();

    fireEvent.click(screen.getByRole("button", { name: "File escalation" }));
    await waitFor(() =>
      expect(state().labels).toEqual([
        "Opened the escalation form on PO-88213",
        "The escalation was refused on PO-88213",
      ]),
    );
    // No coded step, so nothing is handed to the chat as "the code that worked".
    expect(state().code).toBeNull();
    // The release stays locked until something is actually on file.
    expect(
      screen
        .getByRole("button", { name: /^Release the/ })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("offers no filing surface to a planner nothing is gated for", () => {
    planner.current = DIRECTOR;
    ledger.lanes = LANES;
    ledger.shipments = [shipment("PO-88213")];
    mount();
    expect(screen.queryByLabelText("Escalation code")).toBeNull();
    expect(screen.getByText(/approves without a limit/)).toBeTruthy();
  });

  it("offers no filing surface when nothing is over the cap", () => {
    planner.current = ROSA;
    ledger.lanes = LANES;
    // 100 kg by air is $600 — well under Rosa's cap, so there is no case.
    ledger.shipments = [{ ...shipment("PO-88240"), weightKg: 100 }];
    mount();
    expect(screen.queryByLabelText("Escalation code")).toBeNull();
    expect(screen.getByText(/above your approval authority/)).toBeTruthy();
  });
});
