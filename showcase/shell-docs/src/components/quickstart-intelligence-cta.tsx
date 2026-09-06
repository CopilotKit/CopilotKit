import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CopilotKitMark } from "@/components/copilotkit-mark";

export function QuickstartIntelligenceCta() {
  return (
    <Link
      href="/intelligence/overview"
      className="shell-docs-radius-surface not-prose group relative my-6 flex flex-col gap-3 overflow-hidden border border-[var(--border)] bg-[var(--bg-surface)] p-4 pl-5 no-underline shadow-[var(--shadow-control)] transition-colors hover:border-[var(--accent)] sm:flex-row sm:items-center sm:justify-between sm:gap-4"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-0.5 bg-[var(--accent)]"
      />
      <span className="flex min-w-0 items-start gap-3">
        <CopilotKitMark className="mt-0.5 h-5 w-[18px] shrink-0" />
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold leading-snug text-[var(--text)]">
            Your sample chat is running
          </span>
          <span className="mt-1 block text-[13.5px] leading-relaxed text-[var(--text-muted)]">
            Add persistent threads, analytics, inspection, and learning when
            your app is ready for them.
          </span>
        </span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-[var(--accent)]">
        Explore Intelligence
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}
