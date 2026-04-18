// Shared helpers used by all 5 variant-presentation cell renderers.
import {
  type BadgeTone,
  type Variant,
  getDemoStatus,
  healthBadge,
  qaBadge,
  testBadge,
} from "@/lib/status";
import { Badge, HealthDot, TONE_CLASS } from "@/components/badges";
import type { CellContext } from "@/components/feature-grid";

export interface VariantLinks {
  demoUrl: string;
  codeUrl: string;
  hostedUrl: string;
}

export function urlsForVariant(
  ctx: CellContext,
  variantName: string | null,
): VariantLinks {
  // Variant-specific deep links: we append `?variant=<name>` to both the
  // shell routes (so /code can highlight variant-specific files) and the
  // hosted URL (so a future showcase demo can pick the variant).
  const q = variantName ? `?variant=${encodeURIComponent(variantName)}` : "";
  return {
    demoUrl: `${ctx.shellUrl}/integrations/${ctx.integration.slug}/${ctx.feature.id}/preview${q}`,
    codeUrl: `${ctx.shellUrl}/integrations/${ctx.integration.slug}/${ctx.feature.id}/code${q}`,
    hostedUrl: `${ctx.hostedUrl}${q}`,
  };
}

export function DemoCodeRow({ links }: { links: VariantLinks }) {
  return (
    <div className="flex items-center gap-2.5">
      <a
        href={links.demoUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="whitespace-nowrap text-[var(--accent)] hover:underline"
      >
        <span className="text-[var(--text-muted)]">Demo</span> <span>↗</span>
      </a>
      <a
        href={links.codeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="whitespace-nowrap text-[var(--accent)] hover:underline"
      >
        <span className="text-[var(--text-muted)]">Code</span>{" "}
        <span>{"</>"}</span>
      </a>
    </div>
  );
}

export function SignalRow({
  e2e,
  smoke,
  qa,
  health,
  links,
}: {
  e2e: ReturnType<typeof testBadge>;
  smoke: ReturnType<typeof testBadge>;
  qa: ReturnType<typeof qaBadge>;
  health: ReturnType<typeof healthBadge>;
  links: VariantLinks;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Badge name="E2E" state={e2e} />
      <Badge name="Smoke" state={smoke} />
      <Badge name="QA" state={qa} />
      <HealthDot state={health} href={links.hostedUrl} />
    </div>
  );
}

export function resolveBadges(
  v: Variant | null,
  bundleStale: boolean,
  fallback: ReturnType<typeof getDemoStatus>,
) {
  const src = v ?? fallback;
  return {
    e2e: testBadge(src?.e2e ?? null, bundleStale),
    smoke: testBadge(src?.smoke ?? null, bundleStale),
    qa: qaBadge(src?.qa ?? null, bundleStale),
    health: healthBadge(
      src?.health ?? { status: "unknown", checked_at: "" },
      bundleStale,
    ),
  };
}

export function getSignalTone(
  v: Variant,
  bundleStale: boolean,
  kind: "e2e" | "smoke" | "qa" | "health",
): BadgeTone {
  if (kind === "e2e") return testBadge(v.e2e, bundleStale).tone;
  if (kind === "smoke") return testBadge(v.smoke, bundleStale).tone;
  if (kind === "qa") return qaBadge(v.qa, bundleStale).tone;
  return healthBadge(v.health, bundleStale).tone;
}

export { TONE_CLASS };
