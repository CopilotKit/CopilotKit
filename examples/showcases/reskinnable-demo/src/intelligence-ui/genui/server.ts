/**
 * The generative UI of one recorded step, ready to render. SERVER-ONLY.
 *
 * Finds the step in today's captured trajectories (the learning store, read
 * only) or the seeded history, works out which of Ledgerline's components it
 * drew (./derive.ts), and fills in what the recording left out on purpose:
 * a review card is recorded without its receipt images, so each receipt is
 * read back from Ledgerline's receipt store by id; a seeded report card names
 * its report, which is read from the ledger the way `getReport` reads it.
 */
import * as store from "@/skins/ledgerline/learning/store";
import * as ledger from "@/skins/ledgerline/data/store";
import { agentReport } from "@/skins/ledgerline/data/agent-view";
import { RECEIPTS } from "@/skins/ledgerline/data/recon-seed";
import { seedDetail } from "../seed/history";
import type { GenUiRecord, TrajectoryDetail } from "../data/contract";
import { findStep, genUiOf } from "./derive";

type Obj = Record<string, unknown>;

function detailOf(trajectoryId: string): TrajectoryDetail | null {
  return (
    (store.trajectoryDetail(trajectoryId) as TrajectoryDetail | null) ??
    seedDetail(trajectoryId)
  );
}

/** A review view with every receipt read back in full (lines, tip, address). */
function withReceipts(view: Obj): Obj {
  const pairs = Array.isArray(view.pairs) ? (view.pairs as Obj[]) : [];
  return {
    ...view,
    pairs: pairs.map((p) => ({
      ...p,
      receipts: (Array.isArray(p.receipts) ? (p.receipts as Obj[]) : []).map(
        (r) => RECEIPTS.find((full) => full.id === r.id) ?? r,
      ),
    })),
  };
}

function reportView(reportId: unknown): Obj | null {
  if (typeof reportId !== "string") return null;
  try {
    return agentReport(ledger.getReport(reportId)) as unknown as Obj;
  } catch {
    return null;
  }
}

function hydrate(ui: GenUiRecord): GenUiRecord | null {
  const p = ui.props as Obj;
  switch (ui.component) {
    case "ReviewMatchesCard":
      return { ...ui, props: withReceipts(p) };
    case "ReportCard": {
      const report = (p.report as Obj | undefined) ?? reportView(p.reportId);
      return report ? { ...ui, props: { ...p, report } } : null;
    }
    case "LedgerlineAppWidget": {
      let sc = p.structuredContent as Obj | undefined;
      if (!sc && p.reportId) {
        const report = reportView(p.reportId);
        if (!report) return null;
        sc = { ...report, kind: "report-card", report };
      }
      if (!sc) return null;
      return {
        ...ui,
        props: {
          ...p,
          structuredContent: sc.kind === "review-card" ? withReceipts(sc) : sc,
        },
      };
    }
    default:
      return ui;
  }
}

/** The component and props one step drew, or null when it drew none. */
export function recordedGenUi(
  trajectoryId: string,
  stepRef: string,
): GenUiRecord | null {
  const detail = detailOf(trajectoryId);
  const found = detail ? findStep(detail, stepRef) : null;
  const ui = found ? genUiOf(found.step, found.surface, found.trace) : null;
  return ui ? hydrate(ui) : null;
}
