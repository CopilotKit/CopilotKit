// Shared logo marks and compact option grids for the setup wizard.
// Selection state and click handlers come from setup-wizard.tsx.

import React from "react";
import {
  Check,
  MessageSquare,
  MessagesSquare,
  Brain,
  Paintbrush,
  Repeat,
  Settings,
  User,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { FrontendLogo } from "./frontend-logo";
import { FrameworkLogo } from "./icons/framework-icons";
import type {
  LucideIconName,
  MapCapability,
  MapPick,
  MapPickLogo,
} from "@/lib/homepage-map";

// Named imports in an explicit record, never `import * as icons` with a
// dynamic index: a namespace object indexed at runtime forces the bundler to
// retain every lucide export, and Next's optimizePackageImports cannot
// rewrite it. Same idiom as FRAMEWORK_ICONS in ./icons/framework-icons.tsx.
const CAPABILITY_ICONS: Record<LucideIconName, LucideIcon> = {
  MessageSquare,
  MessagesSquare,
  Brain,
  Paintbrush,
  User,
  Settings,
  Repeat,
  Wrench,
};

/** Looks up and draws a capability's icon. Exported (the lookup record
 *  itself is not) so the wizard's review step can render the same mark
 *  without keeping a second copy of `CAPABILITY_ICONS` — see the header
 *  comment above on why that record is a named-import map rather than a
 *  namespace import: a second copy would invite the same bundle-size
 *  regression this one exists to avoid. */
export function CapabilityIconMark({
  icon,
  className,
}: {
  icon: LucideIconName;
  className?: string;
}): React.JSX.Element {
  const Icon = CAPABILITY_ICONS[icon];
  return <Icon className={className ?? "h-3.5 w-3.5"} />;
}

/** Draws whichever logo the pick's data asked for. The switch is the whole of
 *  this component's knowledge: which logo belongs to which pick is decided in
 *  `@/lib/homepage-map`. Exported so the wizard's review step can render the
 *  same mark instead of re-deciding frontend-vs-framework on its own — which
 *  logo belongs to which pick is one decision, not two implementations. The
 *  agent-backend logos carry `--accent` (blue-violet), matching the identical
 *  `FrameworkLogo` in `./framework-selector`'s own picker; `FrontendLogo` is a
 *  different component and is left at its own default treatment. */
export function PickLogoMark({
  logo,
  size = 14,
}: {
  logo: MapPickLogo;
  size?: number;
}): React.JSX.Element {
  if (logo.kind === "frontend") {
    return <FrontendLogo icon={logo.icon} size={size} className="shrink-0" />;
  }
  return (
    <FrameworkLogo
      slug={logo.slug}
      fallbackSrc={logo.fallbackSrc}
      size={size}
      className="shrink-0 text-[var(--accent)]"
    />
  );
}

/** Shared border/fill treatment for an option button in either grid — the
 *  accent ring-and-fill when selected doubles as the only selection signal
 *  `PickGrid` gives, since it renders no checkmark. */
function optionToneClass(selected: boolean): string {
  return selected
    ? "border-[var(--accent)] bg-[var(--accent-dim)]"
    : "border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)]";
}

export function PickGrid({
  picks,
  selectedId,
  onSelect,
}: {
  picks: readonly MapPick[];
  selectedId?: string;
  onSelect: (id: string, pointerActivated: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="wizard-pick-grid grid content-start grid-cols-1 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(min(100%,11rem),1fr))]">
      {picks.map((pick) => {
        const selected = pick.id === selectedId;
        return (
          <button
            key={pick.id}
            title={pick.summary}
            type="button"
            aria-pressed={selected}
            onClick={(event) => onSelect(pick.id, event.detail > 0)}
            className={`shell-docs-radius-control flex min-h-11 cursor-pointer items-center gap-2 border px-3 py-2.5 text-left transition-colors ${optionToneClass(selected)}`}
          >
            <PickLogoMark logo={pick.logo} />
            <span className="text-xs font-medium leading-relaxed text-[var(--text-secondary)]">
              {pick.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function CapabilityGrid({
  capabilities,
  selectedIds,
  onToggle,
}: {
  capabilities: readonly MapCapability[];
  selectedIds: readonly string[];
  onToggle: (id: string) => void;
}): React.JSX.Element {
  return (
    <div className="wizard-capability-grid grid grid-cols-1 gap-2 sm:grid-cols-2">
      {capabilities.map((capability) => {
        const selected = selectedIds.includes(capability.id);
        return (
          <button
            key={capability.id}
            title={capability.body}
            type="button"
            aria-pressed={selected}
            onClick={() => onToggle(capability.id)}
            className={`shell-docs-radius-surface block w-full cursor-pointer border p-3.5 text-left transition-colors ${optionToneClass(
              selected,
            )}`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className="shell-docs-radius-icon flex h-7 w-7 shrink-0 items-center justify-center border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--accent)]"
                >
                  <CapabilityIconMark icon={capability.icon} />
                </span>
                <span className="truncate text-sm font-semibold leading-snug text-[var(--text)]">
                  {capability.title}
                </span>
              </span>
              {selected ? (
                <Check
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-[var(--accent)]"
                />
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
