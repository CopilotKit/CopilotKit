import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { docsHref } from "../href";
import type { DocsScope } from "../scope";
import { CtaCardBody, ctaCardClass } from "./cta-card";

/** The Copilot Cloud dashboard, as shell-docs' MDX registry links it. */
const COPILOT_CLOUD_URL = "https://dashboard.operations.copilotkit.ai";

/**
 * An inline link to Copilot Cloud. shell-docs' registry version always said
 * "CopilotKit Cloud"; this one keeps the authored link text when there is
 * some. `asButton` is accepted and ignored: every use is inline.
 */
export function LinkToCopilotCloud({
  children,
}: {
  children?: ReactNode;
  asButton?: boolean;
}) {
  return <a href={COPILOT_CLOUD_URL}>{children ?? "CopilotKit Cloud"}</a>;
}

/** The "Sign up for CopilotKit Cloud" box from the What's new page. */
export function SignUpSection() {
  return (
    <div className="not-prose my-6 rounded-xl border bg-card p-4">
      <a
        href={COPILOT_CLOUD_URL}
        className="group inline-flex items-center gap-1.5 text-sm font-semibold text-primary no-underline"
      >
        Sign up for CopilotKit Cloud
        <ArrowRight
          className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none"
          aria-hidden
        />
      </a>
    </div>
  );
}

/** The built-in agent quickstart's closing nudge toward Intelligence. */
export function QuickstartIntelligenceCta({ scope }: { scope: DocsScope }) {
  return (
    <Link
      href={docsHref("/intelligence/overview", scope)}
      className={ctaCardClass("inline")}
    >
      <CtaCardBody
        size="inline"
        title="Your sample chat is running"
        body="Add persistent threads, analytics, inspection, and learning when your app is ready for them."
        label="Explore Intelligence"
      />
    </Link>
  );
}
