"use client";

import { Group, Separator } from "react-resizable-panels";
import type {
  GroupProps,
  LayoutStorage,
  SeparatorProps,
} from "react-resizable-panels";

import { cn } from "@/lib/utils";

/**
 * Thin wrapper over `react-resizable-panels` v4.
 *
 * ⚠️ v4 RENAMED THE API. Six other examples in this monorepo (examples/canvas/*,
 * examples/showcases/orca) sit on 2.x/3.x, and virtually every tutorial online —
 * including shadcn's `Resizable` block — targets the old names. Do NOT copy them:
 *
 *   PanelGroup            → Group
 *   direction             → orientation
 *   PanelResizeHandle     → Separator
 *   autoSaveId            → useDefaultLayout({ id, storage })
 *   Panel order=          → removed; reorder by JSX order
 *   onCollapse/onExpand   → removed; use panelRef + onResize
 *
 * Bare-number sizes are PIXELS (`minSize={200}` is 200px) — this is why the pin
 * is 4.x; 3.x is percentage-only. `Panel`'s `className` lands on a NESTED div,
 * so panel geometry comes from `minSize`/`defaultSize`/`collapsedSize`, never
 * from classes. Emitted style hooks: `data-group`, `data-panel`,
 * `data-separator`.
 *
 * The type declarations in node_modules are the authority over any doc site.
 */
export { Panel, useDefaultLayout, usePanelRef } from "react-resizable-panels";
export type {
  GroupProps,
  PanelProps,
  SeparatorProps,
} from "react-resizable-panels";

/**
 * `useDefaultLayout` wants a Storage implementation, but this renders during
 * Next's server pass where `localStorage` does not exist — and in a privacy-mode
 * browser where merely touching it throws. Fail soft: no persistence, never a
 * crash. A forgotten layout is a cosmetic loss.
 */
export const safeLayoutStorage: LayoutStorage = {
  getItem(key) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Intentionally ignored — see the note above.
    }
  },
};

export function ResizableGroup({ className, ...props }: GroupProps) {
  return <Group className={cn("flex h-full w-full", className)} {...props} />;
}

/**
 * The 8px gutter BETWEEN cards. In this layout the gap itself is the grab
 * target, so nothing is drawn at rest; a pill fades in on hover/focus to give
 * the affordance.
 *
 * No `shrink-0` here: `Separator` refuses `flex-grow`/`flex-shrink` overrides,
 * so it would be dead code.
 */
export function ResizableGutter({ className, ...props }: SeparatorProps) {
  return (
    <Separator
      className={cn(
        "relative w-2 outline-none",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2",
        "after:rounded-full after:bg-transparent after:transition-colors",
        "hover:after:bg-hairline focus-visible:after:bg-brand",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The 1px divider INSIDE the chat card, between threads and conversation — a
 * line with no gap, per the approved sketch. (`shrink-0` omitted for the same
 * reason as the gutter.)
 */
export function ResizableHairline({ className, ...props }: SeparatorProps) {
  return (
    <Separator
      className={cn(
        "w-px bg-hairline outline-none transition-colors",
        "hover:bg-brand/40 focus-visible:bg-brand",
        className,
      )}
      {...props}
    />
  );
}
