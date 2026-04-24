"use client";
/**
 * IntegrationHeader — column header with integration name + parity badge.
 */
import { ParityBadge, type ParityTier } from "./parity-badge";

export interface IntegrationHeaderProps {
  slug: string;
  name: string;
  tier: ParityTier;
}

export function IntegrationHeader({
  slug,
  name,
  tier,
}: IntegrationHeaderProps) {
  return (
    <div
      data-testid={`integration-header-${slug}`}
      className="flex flex-col gap-0.5"
    >
      <span className="text-xs font-semibold text-[var(--text)]">{name}</span>
      <ParityBadge tier={tier} />
    </div>
  );
}
