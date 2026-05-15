"use client";
/**
 * OverlayToggleBar — toggle pills for overlay layers + preset quick-apply buttons.
 *
 * Dense, compact bar matching existing dashboard density. Overlay pills toggle
 * individual visual overlays; presets apply curated combinations.
 */

import type { Overlay } from "@/lib/overlay-types";
export type { Overlay };

export interface OverlayPreset {
  id: string;
  label: string;
  overlays: readonly Overlay[];
}

export const ALL_OVERLAYS: readonly Overlay[] = [
  "links",
  "depth",
  "health",
  "parity",
  "docs",
];

export const PRESETS: readonly OverlayPreset[] = [
  { id: "catalog", label: "Catalog", overlays: ["links", "health", "docs"] },
  { id: "assessment", label: "Assessment", overlays: ["depth", "health"] },
  {
    id: "parity-review",
    label: "Parity Review",
    overlays: ["depth", "parity"],
  },
];

const OVERLAY_LABELS: Record<Overlay, string> = {
  links: "Links",
  depth: "Depth",
  health: "Health",
  parity: "Parity",
  docs: "Docs",
};

export interface OverlayToggleBarProps {
  overlays: Set<Overlay>;
  onToggle: (overlay: Overlay) => void;
  onApplyPreset: (presetId: string) => void;
  activePreset: string | null;
}

export function OverlayToggleBar({
  overlays,
  onToggle,
  onApplyPreset,
  activePreset,
}: OverlayToggleBarProps) {
  return (
    <div
      data-testid="overlay-toggle-bar"
      className="flex items-center gap-[6px] px-2 py-[6px] bg-[var(--bg-muted)] rounded-[6px] border border-[var(--border)]"
    >
      {/* Preset buttons */}
      {PRESETS.map((preset) => {
        const isPresetActive = activePreset === preset.id;
        return (
          <button
            key={preset.id}
            type="button"
            data-testid={`preset-btn-${preset.id}`}
            onClick={() => onApplyPreset(preset.id)}
            className={`px-[6px] py-[2px] rounded-[4px] text-[9px] font-medium transition-colors cursor-pointer border ${
              isPresetActive
                ? "bg-[var(--accent)]/10 text-[var(--accent)] border-[var(--accent)]"
                : "text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--accent)] hover:border-[var(--accent)]"
            }`}
          >
            {preset.label}
          </button>
        );
      })}

      {/* Separator */}
      <div className="w-px h-4 bg-[var(--border)] mx-[2px]" />

      {/* Label */}
      <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] font-medium select-none">
        Show:
      </span>

      {/* Overlay pills */}
      {ALL_OVERLAYS.map((overlay) => {
        const isActive = overlays.has(overlay);
        const isParity = overlay === "parity";
        const activeBg =
          isParity && isActive ? "bg-[#7c3aed]" : "bg-[var(--accent)]";
        return (
          <button
            key={overlay}
            type="button"
            data-testid={`overlay-pill-${overlay}`}
            onClick={() => onToggle(overlay)}
            className={`px-2 py-[3px] rounded-full text-[10px] font-semibold transition-colors cursor-pointer ${
              isActive
                ? `${activeBg} text-white`
                : "bg-transparent text-[var(--text-muted)] border border-[var(--border)]"
            }`}
          >
            {OVERLAY_LABELS[overlay]}
          </button>
        );
      })}
    </div>
  );
}
