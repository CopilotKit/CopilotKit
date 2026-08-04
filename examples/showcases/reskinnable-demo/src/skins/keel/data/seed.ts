import type { Playbook, PolicyRef, Run, RunStep, StepStatus } from "./types";

/** PolicyRef builder. Field values are fixed by spec §6.2 + §5.1. */
const ref = (docId: string, refNo: string, sectionId: string): PolicyRef => ({
  docId,
  ref: refNo,
  sectionId,
});

/**
 * The four automatable processes. Every step carries a `policyRef`; approval
 * gates set `requiresApproval: true` and an `approverRole`. Ids and refs are the
 * spec's (§6.2) — three other units reference them, so they are not ours to
 * change. `vendor-baa-review`'s `legal-sign` gate requires "Legal Counsel",
 * which is deliberately NOT a persona, to demonstrate the "waiting on someone
 * else" state.
 */
export const KEEL_PLAYBOOKS: Playbook[] = [
  {
    id: "phi-access-contractor",
    title: "Grant PHI Access to a Contractor",
    summary:
      "Provision minimum-necessary EHR access for an external contractor, with a Privacy Officer scope review.",
    space: "privacy",
    inputs: [
      { key: "subject", label: "Contractor" },
      { key: "endDate", label: "Engagement end date" },
      { key: "department", label: "Department" },
    ],
    steps: [
      {
        id: "identity-verify",
        title: "Verify identity & engagement record",
        role: "HR Operations",
        requiresApproval: false,
        policyRef: ref("phi-access-policy", "POL-114", "workforce-clearance"),
        durationMs: 5000,
      },
      {
        id: "training",
        title: "Confirm HIPAA training completion",
        role: "Compliance",
        requiresApproval: false,
        policyRef: ref("phi-access-policy", "POL-114", "workforce-clearance"),
        durationMs: 4000,
      },
      {
        id: "baa-check",
        title: "Confirm BAA on file for the vendor",
        role: "Legal",
        requiresApproval: false,
        policyRef: ref("baa-requirements", "POL-302", "when-a-baa-is-required"),
        durationMs: 4000,
      },
      {
        id: "scope-review",
        title: "Determine minimum-necessary scope",
        role: "Privacy Office",
        requiresApproval: true,
        approverRole: "Privacy Officer",
        policyRef: ref("phi-access-policy", "POL-114", "minimum-necessary"),
        durationMs: 6000,
      },
      {
        id: "provision",
        title: "Provision role-based EHR access",
        role: "IT Identity",
        requiresApproval: false,
        policyRef: ref("data-classification", "STD-031", "handling-by-tier"),
        durationMs: 5000,
      },
      {
        id: "audit-enroll",
        title: "Enroll in access audit review",
        role: "Privacy Office",
        requiresApproval: false,
        policyRef: ref("phi-access-policy", "POL-114", "audit-logging"),
        durationMs: 4000,
      },
    ],
  },
  {
    id: "credential-practitioner",
    title: "Credential a Practitioner",
    summary:
      "Verify a practitioner's credentials and grant provisional privileges after Credentials Committee review.",
    space: "clinical",
    inputs: [
      { key: "subject", label: "Practitioner" },
      { key: "specialty", label: "Specialty" },
      { key: "startDate", label: "Start date" },
    ],
    steps: [
      {
        id: "application-intake",
        title: "Application intake",
        role: "Medical Staff Office",
        requiresApproval: false,
        policyRef: ref(
          "credentialing-standard",
          "POL-203",
          "primary-source-verification",
        ),
        durationMs: 4000,
      },
      {
        id: "psv",
        title: "Primary source verification",
        role: "Medical Staff Office",
        requiresApproval: false,
        policyRef: ref(
          "credentialing-standard",
          "POL-203",
          "primary-source-verification",
        ),
        durationMs: 6000,
      },
      {
        id: "license-dea",
        title: "License & DEA registration check",
        role: "Medical Staff Office",
        requiresApproval: false,
        policyRef: ref("credentialing-standard", "POL-203", "license-and-dea"),
        durationMs: 5000,
      },
      {
        id: "malpractice",
        title: "Malpractice history review",
        role: "Risk Management",
        requiresApproval: false,
        policyRef: ref(
          "credentialing-standard",
          "POL-203",
          "malpractice-history",
        ),
        durationMs: 5000,
      },
      {
        id: "committee",
        title: "Credentials Committee review",
        role: "Medical Staff",
        requiresApproval: true,
        approverRole: "Chief Medical Officer",
        policyRef: ref("credentialing-standard", "POL-203", "committee-review"),
        durationMs: 7000,
      },
      {
        id: "privileges",
        title: "Grant provisional privileges",
        role: "Medical Staff Office",
        requiresApproval: false,
        policyRef: ref(
          "credentialing-standard",
          "POL-203",
          "provisional-privileges",
        ),
        durationMs: 4000,
      },
    ],
  },
  {
    id: "vendor-baa-review",
    title: "Vendor BAA & Security Review",
    summary:
      "Tier a new vendor, review third-party security evidence, and execute a BAA before onboarding.",
    space: "vendor",
    inputs: [
      { key: "subject", label: "Vendor" },
      { key: "dataTypes", label: "Data types shared" },
      { key: "owner", label: "Internal owner" },
    ],
    steps: [
      {
        id: "intake",
        title: "Vendor intake & risk tiering",
        role: "Procurement",
        requiresApproval: false,
        policyRef: ref("third-party-risk", "STD-045", "risk-tiering"),
        durationMs: 4000,
      },
      {
        id: "evidence",
        title: "Collect SOC 2 / HITRUST evidence",
        role: "Information Security",
        requiresApproval: false,
        policyRef: ref("third-party-risk", "STD-045", "soc2-and-hitrust"),
        durationMs: 6000,
      },
      {
        id: "security-review",
        title: "Third-party security review",
        role: "Information Security",
        requiresApproval: true,
        approverRole: "Information Security Lead",
        policyRef: ref("third-party-risk", "STD-045", "required-evidence"),
        durationMs: 6000,
      },
      {
        id: "baa-draft",
        title: "Draft BAA with subcontractor flowdown",
        role: "Legal",
        requiresApproval: false,
        policyRef: ref("baa-requirements", "POL-302", "subcontractor-flowdown"),
        durationMs: 5000,
      },
      {
        id: "legal-sign",
        title: "Legal execution",
        role: "Legal",
        requiresApproval: true,
        approverRole: "Legal Counsel",
        policyRef: ref("baa-requirements", "POL-302", "execution-and-storage"),
        durationMs: 6000,
      },
      {
        id: "register",
        title: "Register in vendor inventory",
        role: "Procurement",
        requiresApproval: false,
        policyRef: ref("third-party-risk", "STD-045", "annual-review"),
        durationMs: 4000,
      },
    ],
  },
  {
    id: "adverse-event",
    title: "Report an Adverse Event",
    summary:
      "Capture and triage an adverse event, decide whether a root-cause analysis is required, and close it out.",
    space: "clinical",
    inputs: [
      { key: "subject", label: "Event" },
      { key: "unit", label: "Unit" },
      { key: "occurredAt", label: "Occurred at" },
    ],
    steps: [
      {
        id: "intake",
        title: "Capture event details",
        role: "Quality & Safety",
        requiresApproval: false,
        policyRef: ref("adverse-event-reporting", "POL-208", "what-to-report"),
        durationMs: 4000,
      },
      {
        id: "severity",
        title: "Assign severity level",
        role: "Quality & Safety",
        requiresApproval: false,
        policyRef: ref("adverse-event-reporting", "POL-208", "severity-levels"),
        durationMs: 4000,
      },
      {
        id: "notify",
        title: "Notify Quality & Safety leadership",
        role: "Quality & Safety",
        requiresApproval: false,
        policyRef: ref("adverse-event-reporting", "POL-208", "timeframes"),
        durationMs: 5000,
      },
      {
        id: "rca-decision",
        title: "Determine whether RCA is required",
        role: "Quality Director",
        requiresApproval: true,
        approverRole: "Chief Medical Officer",
        policyRef: ref(
          "adverse-event-reporting",
          "POL-208",
          "root-cause-analysis",
        ),
        durationMs: 6000,
      },
      {
        id: "close",
        title: "Document and close",
        role: "Quality & Safety",
        requiresApproval: false,
        // Plan §6.2 wrote "documentation" here, but the POL-208 corpus doc
        // (spec §5.1 / Task 2) has no such section — "documentation" belongs to
        // the unrelated breach-response doc (POL-121). Citing it would point an
        // approval card at a section that does not exist. Mapped to
        // "root-cause-analysis", the POL-208 section whose action-plan closure
        // language governs documenting and closing an event (section reuse is
        // already an established pattern in this seed).
        policyRef: ref(
          "adverse-event-reporting",
          "POL-208",
          "root-cause-analysis",
        ),
        durationMs: 4000,
      },
    ],
  },
];

function playbookById(id: string): Playbook {
  const pb = KEEL_PLAYBOOKS.find((p) => p.id === id);
  if (!pb) throw new Error(`seed: unknown playbook ${id}`);
  return pb;
}

/** base epoch (ms) + minutes, as an ISO string. */
function at(baseMs: number, minutes: number): string {
  return new Date(baseMs + minutes * 60_000).toISOString();
}

interface StepDecor {
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  approvedBy?: string;
}

function instantiate(
  pb: Playbook,
  decorate: (i: number) => StepDecor,
): RunStep[] {
  return pb.steps.map((step, i) => ({ ...step, ...decorate(i) }));
}

const CRED = playbookById("credential-practitioner");
const VENDOR = playbookById("vendor-baa-review");
const ADVERSE = playbookById("adverse-event");
const PHI = playbookById("phi-access-contractor");

/**
 * Build the four pre-existing runs anchored RELATIVE to `now` (ms epoch), so
 * every span reads sensibly whenever the demo runs. The live app compares these
 * timestamps against `Date.now()` (the engine's overdue check, `use-data`'s
 * `runCycleTimeMs`), so fixed calendar anchors would drift: a "running" step
 * seeded in the past is instantly overdue, and a completed run whose first step
 * sat in the past yields a multi-day cycle time. Expressing every stamp as an
 * offset from `now` keeps a completed run's cycle time in the order of minutes
 * and a live run's current step un-elapsed at seed time. `now` is a PARAMETER
 * (not a module-load constant) so every `seedKeelRuns()` call — including a skin
 * remount — gets a fresh anchor and injectable tests stay deterministic.
 */
function buildSeedRuns(now: number): Run[] {
  const HOUR = 60; // minutes

  // RUN-1041 — credential-practitioner, fully completed. Anchored so its whole
  // run sits in the recent past; the 6 steps span ~69 min start→last-completion,
  // i.e. a cycle time on the order of an hour (plausible on the Desk KPI).
  const base1041 = now - 3 * HOUR * 60_000; // started ~3h ago
  const run1041: Run = {
    id: "RUN-1041",
    playbookId: CRED.id,
    title: CRED.title,
    subject: "Dr. Amara Osei — Cardiology",
    requestedBy: "Medical Staff Office",
    createdAt: at(base1041, 0),
    status: "completed",
    steps: instantiate(CRED, (i) => ({
      status: "done",
      startedAt: at(base1041, i * 12),
      completedAt: at(base1041, i * 12 + 9),
      ...(CRED.steps[i].requiresApproval
        ? { approvedBy: "Dr. Marcus Ellis" }
        : {}),
    })),
  };

  // RUN-1042 — vendor-baa-review, blocked at `security-review` (index 2).
  // Created ~40 min ago; two steps done, the gate awaiting since ~16 min ago.
  const base1042 = now - 40 * 60_000;
  const run1042: Run = {
    id: "RUN-1042",
    playbookId: VENDOR.id,
    title: VENDOR.title,
    subject: "Corvus Imaging Analytics",
    requestedBy: "Procurement",
    createdAt: at(base1042, 0),
    status: "blocked",
    steps: instantiate(VENDOR, (i) => {
      if (i < 2) {
        return {
          status: "done",
          startedAt: at(base1042, i * 12),
          completedAt: at(base1042, i * 12 + 9),
        };
      }
      if (i === 2) {
        return { status: "awaiting_approval", startedAt: at(base1042, 24) };
      }
      return { status: "pending" };
    }),
  };

  // RUN-1043 — adverse-event, running mid-sequence at `notify` (index 2). The
  // two done steps started a few minutes ago; the CURRENT running step is
  // anchored to `now` itself, so it is NOT already overdue at seed time (the
  // engine's `now - startedAt > durationMs` check is false) and animates instead
  // of snapping to blocked. Because the run started only minutes ago, its cycle
  // time when it eventually completes during the demo is minutes, not days.
  const base1043 = now - 6 * 60_000; // started ~6 min ago
  const run1043: Run = {
    id: "RUN-1043",
    playbookId: ADVERSE.id,
    title: ADVERSE.title,
    subject: "Fall, 4 West",
    requestedBy: "Ana Reyes",
    createdAt: at(base1043, 0),
    status: "running",
    steps: instantiate(ADVERSE, (i) => {
      if (i < 2) {
        return {
          status: "done",
          startedAt: at(base1043, i * 3),
          completedAt: at(base1043, i * 3 + 2),
        };
      }
      if (i === 2) return { status: "running", startedAt: at(now, 0) };
      return { status: "pending" };
    }),
  };

  // RUN-1044 — phi-access-contractor, blocked at `scope-review` (index 3).
  // Created ~25 min ago; three steps done, the gate awaiting since ~1 min ago.
  const base1044 = now - 25 * 60_000;
  const run1044: Run = {
    id: "RUN-1044",
    playbookId: PHI.id,
    title: PHI.title,
    subject: "Devin Cole — Radiology contractor",
    requestedBy: "Ana Reyes",
    createdAt: at(base1044, 0),
    status: "blocked",
    steps: instantiate(PHI, (i) => {
      if (i < 3) {
        return {
          status: "done",
          startedAt: at(base1044, i * 8),
          completedAt: at(base1044, i * 8 + 6),
        };
      }
      if (i === 3) {
        return { status: "awaiting_approval", startedAt: at(base1044, 24) };
      }
      return { status: "pending" };
    }),
  };

  return [run1041, run1042, run1043, run1044];
}

/**
 * The four pre-existing runs, so the Desk is never empty (§6.3). A module-load
 * snapshot used by unit tests for shape assertions; the live app always builds
 * fresh via `seedKeelRuns()` so its anchor tracks the wall clock.
 */
export const KEEL_SEED_RUNS: Run[] = buildSeedRuns(Date.now());

/**
 * A fresh copy of the seeds for `useState` init, so a skin remount starts from
 * pristine data anchored to the moment it mounts. `now` is optional (defaults to
 * `Date.now()`) so the zero-arg call site in `use-data` is untouched, while
 * tests can inject a fixed anchor for determinism.
 */
export function seedKeelRuns(now: number = Date.now()): Run[] {
  return buildSeedRuns(now);
}
