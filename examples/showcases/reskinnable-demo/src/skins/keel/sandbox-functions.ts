"use client";

import { useEffect } from "react";
import { z } from "zod";
import type { SandboxFunction } from "@copilotkit/react-core/v2";
import { useKeelDesk } from "@/skins/keel/desk-data";
import type { KeelDeskView } from "@/skins/keel/desk-data";
import type { Run } from "@/skins/keel/data/types";

/**
 * OGUI sandbox functions for the Keel skin, plus the sync that keeps their data
 * live. The handlers read a mutable module-scope `snapshot`; <KeelSandboxDataSync/>
 * mirrors the app's live desk data into it on every meaningful change, so the
 * iframe's LLM-authored JS returns the exact data the user sees. Mirrors banking's
 * sandbox-functions.ts + sandbox-data-sync.tsx, inlined into one file because keel
 * omits the `Providers` slot banking used to mount its sync — KeelTools (Task 10)
 * mounts <KeelSandboxDataSync/> instead.
 *
 * Every handler projects to a compact DTO at the boundary — no raw domain object
 * (full step arrays, timestamps) crosses into the sandbox.
 */

// ── Projection DTOs (allowlist — no raw domain objects cross the boundary) ──
type SafeRun = {
  id: string;
  playbookId: string;
  title: string;
  subject: string;
  requestedBy: string;
  status: Run["status"];
  /** The step currently running or awaiting approval, if any. */
  currentStep: string | null;
};
type SafePlaybook = {
  id: string;
  title: string;
  space: string;
  stepCount: number;
  approvalCount: number;
};
type SafeApproval = {
  runId: string;
  stepTitle: string;
  approverRole: string;
  /** True when the gate awaits the CURRENT role. */
  actionable: boolean;
};
type SafeKpis = {
  openRuns: number;
  blockedRuns: number;
  completedRuns: number;
  approvalsForMe: number;
  medianCycleTimeMs: number | null;
};

type Snapshot = {
  runs: SafeRun[];
  playbooks: SafePlaybook[];
  approvals: SafeApproval[];
  kpis: SafeKpis;
};

/**
 * The single source the sandbox reads. The handlers close over this mutable
 * module binding, so `sandboxFunctions`' identity never changes (no per-render
 * re-registration) while the DATA stays live.
 */
let snapshot: Snapshot = {
  runs: [],
  playbooks: [],
  approvals: [],
  kpis: {
    openRuns: 0,
    blockedRuns: 0,
    completedRuns: 0,
    approvalsForMe: 0,
    medianCycleTimeMs: null,
  },
};

/** Replace the snapshot the handlers read. Sole caller is <KeelSandboxDataSync/>. */
export function setKeelSandboxSnapshot(next: Snapshot): void {
  snapshot = next;
}

function currentStepTitle(run: Run): string | null {
  return (
    run.steps.find(
      (s) => s.status === "running" || s.status === "awaiting_approval",
    )?.title ?? null
  );
}

/** Project the live desk read-model into the boundary DTO snapshot. */
function projectSnapshot(data: KeelDeskView): Snapshot {
  return {
    runs: data.runs.map((r) => ({
      id: r.id,
      playbookId: r.playbookId,
      title: r.title,
      subject: r.subject,
      requestedBy: r.requestedBy,
      status: r.status,
      currentStep: currentStepTitle(r),
    })),
    playbooks: data.playbooks.map((p) => ({
      id: p.id,
      title: p.title,
      space: p.space,
      stepCount: p.steps.length,
      approvalCount: p.steps.filter((s) => s.requiresApproval).length,
    })),
    approvals: data.approvals.map((a) => ({
      runId: a.run.id,
      stepTitle: a.step.title,
      approverRole: a.step.approverRole ?? "—",
      actionable: a.actionable,
    })),
    kpis: {
      openRuns: data.kpis.openRuns,
      blockedRuns: data.kpis.blockedRuns,
      completedRuns: data.kpis.completedRuns,
      approvalsForMe: data.kpis.approvalsForMe,
      medianCycleTimeMs: data.kpis.medianCycleTimeMs,
    },
  };
}

/**
 * Stable module-scope array — safe to hand straight to CopilotKitProvider. The
 * handlers read the mutable snapshot, so the array identity never changes while
 * the data stays live.
 */
export const sandboxFunctions: SandboxFunction[] = [
  {
    name: "getRuns",
    description:
      "Return the current process runs (real app data): id, playbookId, title, " +
      "subject, requestedBy, status, and currentStep. Optional `status` filters " +
      "to queued/running/blocked/completed/cancelled.",
    parameters: z.object({
      status: z
        .enum(["queued", "running", "blocked", "completed", "cancelled"])
        .optional(),
    }),
    handler: async ({ status }: { status?: Run["status"] }) =>
      status ? snapshot.runs.filter((r) => r.status === status) : snapshot.runs,
  },
  {
    name: "getPlaybooks",
    description:
      "Return the automatable playbooks (id, title, space, stepCount, " +
      "approvalCount) — real app data.",
    parameters: z.object({}),
    handler: async () => snapshot.playbooks,
  },
  {
    name: "getApprovals",
    description:
      "Return the open approval gates (runId, stepTitle, approverRole, " +
      "actionable) — real app data. `actionable` is true when the gate awaits " +
      "the current role.",
    parameters: z.object({}),
    handler: async () => snapshot.approvals,
  },
  {
    name: "getKpis",
    description:
      "Return headline KPIs: openRuns, blockedRuns, completedRuns, " +
      "approvalsForMe, medianCycleTimeMs — real app data.",
    parameters: z.object({}),
    handler: async () => snapshot.kpis,
  },
];

/**
 * Mirrors the app's live desk data into the OGUI sandbox snapshot so the iframe's
 * callbacks return exactly what the user sees. Renders nothing. Mount it once
 * inside KeelTools. No JSX, so this stays a valid `.ts` module.
 */
export function KeelSandboxDataSync() {
  const data = useKeelDesk();
  useEffect(() => {
    setKeelSandboxSnapshot(projectSnapshot(data));
  }, [data]);
  return null;
}
