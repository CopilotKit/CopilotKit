"use client";

import { AlertTriangle, Check, FileText, ShieldCheck } from "lucide-react";

// The four beats of clearing an over-limit charge, as a vertical stepper. This
// is the explainer twin of the teach/recall loop: it shows the user (or the
// agent, when asked "how does this work?") the same open → finalize → approve
// procedure the copilot performs, without naming a specific exception code.
const STEPS = [
  {
    icon: AlertTriangle,
    title: "Over-limit charge",
    desc: "The charge exceeds its policy limit, so it can't be approved directly.",
    tone: "text-negative bg-negative-soft",
  },
  {
    icon: FileText,
    title: "File a policy exception",
    desc: "Open an exception against the charge under a justifying code.",
    tone: "text-brand-indigo bg-brand-soft dark:text-brand-violet",
  },
  {
    icon: ShieldCheck,
    title: "Finalize the exception",
    desc: "Finalizing links it to the charge and lifts the policy-limit gate.",
    tone: "text-brand-indigo bg-brand-soft dark:text-brand-violet",
  },
  {
    icon: Check,
    title: "Approve the charge",
    desc: "With the gate lifted, the approval goes through and the charge clears.",
    tone: "text-positive bg-positive-soft",
  },
];

/**
 * Vertical step diagram of how an over-limit charge gets cleared. Static and
 * presentational — numbered/iconed nodes joined by a connector line, in the
 * demo's brand style. Renders well in the narrow chat panel.
 */
export function ApprovalFlowDiagram() {
  return (
    <ol className="space-y-0">
      {STEPS.map((step, i) => {
        const Icon = step.icon;
        const isLast = i === STEPS.length - 1;
        return (
          <li key={step.title} className="relative flex gap-3 pb-5 last:pb-0">
            {!isLast && (
              <span
                aria-hidden
                className="absolute left-[17px] top-9 h-[calc(100%-1.25rem)] w-px bg-hairline"
              />
            )}
            <span
              className={`relative flex h-9 w-9 flex-none items-center justify-center rounded-full ${step.tone}`}
            >
              <Icon className="h-4.5 w-4.5" />
            </span>
            <div className="pt-1">
              <p className="text-sm font-semibold leading-tight text-ink">
                {step.title}
              </p>
              <p className="mt-0.5 text-xs leading-snug text-ink-muted">
                {step.desc}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
