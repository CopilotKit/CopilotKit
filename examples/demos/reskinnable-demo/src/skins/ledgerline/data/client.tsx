"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { ExpenseReport, Ledger } from "./types";
import { emit, trackedFetch } from "../learning/recorder";

/**
 * Ledgerline's client-side snapshot of the expense ledger, shared by the
 * layout, the pages and the agent's tools. It watches `/ledger/version` so a
 * write made elsewhere (the agent, ChatGPT over MCP) shows up within seconds.
 *
 * The `actions` are the USER's writes from the pages: each one is a recorded
 * `network` event and, when it lands, a semantic `expense.*` event. The agent's
 * tools call the REST API directly instead, so the product trajectory holds
 * only what the person did.
 */

export const API = "/api/ledgerline/v1";

interface Ctx {
  data: Ledger;
  refresh: () => Promise<boolean>;
}

const LedgerContext = createContext<Ctx | null>(null);

export function LedgerProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Ledger | null>(null);
  const live = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API}/ledger`, { cache: "no-store" });
      if (!res.ok) throw new Error(`ledger ${res.status}`);
      const snap = (await res.json()) as Ledger;
      if (live.current) setData(snap);
      return true;
    } catch (error) {
      console.error("[ledgerline] ledger refresh failed", error);
      return false;
    }
  }, []);

  useEffect(() => {
    live.current = true;
    fetch(`${API}/ledger`, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`ledger ${res.status}`);
        return res.json() as Promise<Ledger>;
      })
      .then((snap) => {
        if (live.current) setData(snap);
      })
      .catch((error) =>
        console.error("[ledgerline] initial ledger fetch failed", error),
      );
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    let seen: number | null = null;
    const tick = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetch(`${API}/ledger/version`, { cache: "no-store" });
        if (!res.ok) return;
        const { version } = (await res.json()) as { version: number };
        if (seen !== null && version !== seen) await refresh();
        seen = version;
      } catch {
        // A missed tick is harmless.
      }
    };
    const t = setInterval(() => void tick(), 2000);
    void tick();
    return () => clearInterval(t);
  }, [refresh]);

  const value = useMemo(() => ({ data, refresh }), [data, refresh]);
  if (data === null) return null;
  return (
    <LedgerContext.Provider value={value as Ctx}>
      {children}
    </LedgerContext.Provider>
  );
}

export function useLedger(): Ctx {
  const ctx = useContext(LedgerContext);
  if (!ctx) throw new Error("useLedger must be used inside <LedgerProvider>");
  return ctx;
}

export interface ActionResult {
  ok: boolean;
  report?: ExpenseReport;
  error?: string;
  message?: string;
  code?: string;
}

async function post(
  path: string,
  template: string,
  summary: string,
  body?: unknown,
): Promise<ActionResult> {
  const res = await trackedFetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    template,
    summary,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return {
      ok: false,
      error: String(json.error ?? res.status),
      message: String(json.message ?? "The request was refused."),
      code: typeof json.code === "string" ? json.code : undefined,
    };
  }
  return { ok: true, report: json as unknown as ExpenseReport };
}

/** The user's own writes, recorded into the product trajectory. */
export function useLedgerActions() {
  const { refresh } = useLedger();
  return useMemo(
    () => ({
      /**
       * Recode lines, then let the policy engine re-check. Emits
       * `expense.lines_recoded` (what moved where) and
       * `expense.policy_rechecked` (the outcome, with the reason when the hold
       * stays open), so a wrong attempt is part of the trajectory too.
       */
      recode: async (
        r: ExpenseReport,
        changes: { lineId: string; costCenterId: string }[],
        centers: { id: string; name: string }[],
      ): Promise<
        ActionResult & {
          check?: {
            code: string;
            status: "open" | "resolved";
            reason?: string;
          };
        }
      > => {
        const res = await trackedFetch(`${API}/reports/${r.id}/recode`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ lines: changes }),
          template: `${API}/reports/[id]/recode`,
          summary: `Recode ${changes.length} line${changes.length === 1 ? "" : "s"} on ${r.id}`,
        });
        const json = (await res.json().catch(() => ({}))) as {
          report?: ExpenseReport;
          check?: {
            code: string;
            status: "open" | "resolved";
            reason?: string;
          };
          error?: string;
          message?: string;
        };
        if (!res.ok) {
          await refresh();
          return {
            ok: false,
            error: String(json.error ?? res.status),
            message: String(json.message ?? "The recode was refused."),
          };
        }
        const name = (id: string) =>
          centers.find((c) => c.id === id)?.name ?? id;
        emit("expense.lines_recoded", {
          reportId: r.id,
          employee: r.employeeName,
          changes: changes.map((c) => {
            const line = r.lines.find((l) => l.id === c.lineId);
            return {
              lineId: c.lineId,
              description: line?.description,
              amount: line?.amount,
              from: line?.costCenterId,
              to: c.costCenterId,
              toName: name(c.costCenterId),
            };
          }),
          unchanged: r.lines
            .filter((l) => !changes.some((c) => c.lineId === l.id))
            .map((l) => ({
              lineId: l.id,
              description: l.description,
              costCenter: l.costCenterId,
            })),
        });
        emit("expense.policy_rechecked", {
          reportId: r.id,
          code: json.check?.code,
          status: json.check?.status,
          reason: json.check?.reason,
        });
        await refresh();
        return { ok: true, report: json.report, check: json.check };
      },
      approve: async (r: ExpenseReport) => {
        const out = await post(
          `/reports/${r.id}/approve`,
          `${API}/reports/[id]/approve`,
          `Approve ${r.id}`,
        );
        if (out.ok)
          emit("expense.report_approved", {
            reportId: r.id,
            employee: r.employeeName,
            total: r.total,
            by: "user",
          });
        else
          emit("expense.approval_refused", {
            reportId: r.id,
            error: out.error,
            code: out.code,
          });
        await refresh();
        return out;
      },
      reimburse: async (r: ExpenseReport) => {
        const out = await post(
          `/reports/${r.id}/reimburse`,
          `${API}/reports/[id]/reimburse`,
          `Reimburse ${r.id}`,
        );
        if (out.ok) {
          emit("expense.reimbursed", {
            reportId: r.id,
            employee: r.employeeName,
            total: r.total,
            scheduledFor: out.report?.reimbursement?.scheduledFor,
            by: "user",
          });
        }
        await refresh();
        return out;
      },
      addNote: async (r: ExpenseReport, text: string) => {
        const out = await post(
          `/reports/${r.id}/notes`,
          `${API}/reports/[id]/notes`,
          `Add a note to ${r.id}`,
          { text },
        );
        if (out.ok) emit("expense.note_added", { reportId: r.id });
        await refresh();
        return out;
      },
    }),
    [refresh],
  );
}

export { formatDate, formatMoney } from "./format";
