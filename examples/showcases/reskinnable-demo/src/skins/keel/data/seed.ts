import type {
  Playbook,
  PolicyRef,
  Run,
  RunStep,
  StepStatus,
} from "./types";

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

/** base + minutes, as an ISO string. */
function ts(baseIso: string, minutes: number): string {
  return new Date(Date.parse(baseIso) + minutes * 60_000).toISOString();
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

/** Live timestamp for the one seeded run that is mid-flight (RUN-1043). */
const NOW_ISO = new Date().toISOString();

const CRED = playbookById("credential-practitioner");
const VENDOR = playbookById("vendor-baa-review");
const ADVERSE = playbookById("adverse-event");
const PHI = playbookById("phi-access-contractor");

// RUN-1041 — credential-practitioner, fully completed.
const run1041: Run = {
  id: "RUN-1041",
  playbookId: CRED.id,
  title: CRED.title,
  subject: "Dr. Amara Osei — Cardiology",
  requestedBy: "Medical Staff Office",
  createdAt: ts("2026-07-25T09:00:00.000Z", 0),
  status: "completed",
  steps: instantiate(CRED, (i) => ({
    status: "done",
    startedAt: ts("2026-07-25T09:00:00.000Z", i * 12),
    completedAt: ts("2026-07-25T09:00:00.000Z", i * 12 + 9),
    ...(CRED.steps[i].requiresApproval
      ? { approvedBy: "Dr. Marcus Ellis" }
      : {}),
  })),
};

// RUN-1042 — vendor-baa-review, blocked at `security-review` (index 2).
const run1042: Run = {
  id: "RUN-1042",
  playbookId: VENDOR.id,
  title: VENDOR.title,
  subject: "Corvus Imaging Analytics",
  requestedBy: "Procurement",
  createdAt: ts("2026-07-30T14:00:00.000Z", 0),
  status: "blocked",
  steps: instantiate(VENDOR, (i) => {
    if (i < 2) {
      return {
        status: "done",
        startedAt: ts("2026-07-30T14:00:00.000Z", i * 12),
        completedAt: ts("2026-07-30T14:00:00.000Z", i * 12 + 9),
      };
    }
    if (i === 2) {
      return {
        status: "awaiting_approval",
        startedAt: ts("2026-07-30T14:00:00.000Z", 24),
      };
    }
    return { status: "pending" };
  }),
};

// RUN-1043 — adverse-event, running mid-sequence at `notify` (index 2).
const run1043: Run = {
  id: "RUN-1043",
  playbookId: ADVERSE.id,
  title: ADVERSE.title,
  subject: "Fall, 4 West, 2026-07-28",
  requestedBy: "Ana Reyes",
  createdAt: ts("2026-07-28T20:00:00.000Z", 0),
  status: "running",
  steps: instantiate(ADVERSE, (i) => {
    if (i < 2) {
      return {
        status: "done",
        startedAt: ts("2026-07-28T20:00:00.000Z", i * 10),
        completedAt: ts("2026-07-28T20:00:00.000Z", i * 10 + 7),
      };
    }
    if (i === 2) return { status: "running", startedAt: NOW_ISO };
    return { status: "pending" };
  }),
};

// RUN-1044 — phi-access-contractor, blocked at `scope-review` (index 3).
const run1044: Run = {
  id: "RUN-1044",
  playbookId: PHI.id,
  title: PHI.title,
  subject: "Devin Cole — Radiology contractor",
  requestedBy: "Ana Reyes",
  createdAt: ts("2026-08-01T11:00:00.000Z", 0),
  status: "blocked",
  steps: instantiate(PHI, (i) => {
    if (i < 3) {
      return {
        status: "done",
        startedAt: ts("2026-08-01T11:00:00.000Z", i * 12),
        completedAt: ts("2026-08-01T11:00:00.000Z", i * 12 + 9),
      };
    }
    if (i === 3) {
      return {
        status: "awaiting_approval",
        startedAt: ts("2026-08-01T11:00:00.000Z", 36),
      };
    }
    return { status: "pending" };
  }),
};

/** The four pre-existing runs, so the Desk is never empty (§6.3). */
export const KEEL_SEED_RUNS: Run[] = [run1041, run1042, run1043, run1044];

/**
 * A fresh deep copy of the seeds for `useState` init, so a skin remount starts
 * from pristine data. The engine is pure (never mutates in place), so this is a
 * safety belt rather than a strict requirement.
 */
export function seedKeelRuns(): Run[] {
  return KEEL_SEED_RUNS.map((r) => ({
    ...r,
    steps: r.steps.map((s) => ({ ...s })),
  }));
}
