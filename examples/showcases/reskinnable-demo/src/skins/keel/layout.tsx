"use client";

// Side-effect import: loads the .theme-keel token block whenever the keel skin's
// chrome mounts. Without it the skin renders unthemed. (The shell applies the
// `theme-keel` class higher up; this import supplies its values.)
import "./theme.css";

import type { ReactNode } from "react";
import Link from "next/link";
import { useAgentContext } from "@copilotkit/react-core/v2";
import {
  LayoutDashboard,
  BookOpen,
  ClipboardList,
  Activity,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useSkinData } from "@/shell/skin-provider";
import { useRole } from "@/skins/keel/role-context";
import { keelNav } from "@/skins/keel/nav";
import { keelIdentity } from "@/skins/keel/identity";
import type { KeelData } from "@/skins/keel/data/types";
import { useKeelHref, useKeelSegments } from "@/skins/keel/href";

/** Per-segment nav icon. keelNav carries labels only, so the chrome owns the
 *  glyphs — dense, monochrome, utilitarian, in keeping with the theme. */
const NAV_ICONS: Record<string, typeof LayoutDashboard> = {
  "": LayoutDashboard,
  knowledge: BookOpen,
  playbooks: ClipboardList,
  runs: Activity,
};

/**
 * The role switcher — a first-class demo affordance, not a footnote. Switching
 * persona changes which approval gates are actionable (a gate is actionable
 * only when its `approverRole` matches the persona's role), and it re-scopes the
 * Intelligence run via `useKeelRuntimeProperties`. Each option shows the
 * persona's name, role, and unit.
 */
function RoleSwitcher() {
  const { persona, personas, setPersonaId } = useRole();
  return (
    <Select value={persona.id} onValueChange={setPersonaId}>
      <SelectTrigger
        className="h-10 w-[220px] shadow-none"
        aria-label="Switch persona"
      >
        <span className="flex min-w-0 flex-col items-start text-left leading-tight">
          <span className="truncate text-sm font-medium text-ink">
            {persona.name}
          </span>
          <span className="truncate text-[11px] text-ink-muted">
            {persona.role}
          </span>
        </span>
      </SelectTrigger>
      <SelectContent>
        {personas.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-medium text-ink">{p.name}</span>
              <span className="text-xs text-ink-muted">
                {p.role} · {p.unit}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Keel app-shell chrome: a persistent left nav rail, a compact top header
 * (brand mark, role switcher, and a live count of runs awaiting the current
 * persona), and the page — including the shell's canvas region — rendered in
 * the main area. The shared chat panel and skin selector are mounted by the
 * shell, not here.
 */
export function KeelLayout({ children }: { children: ReactNode }) {
  const data = useSkinData<KeelData>();
  const keelHref = useKeelHref();
  const Logo = keelIdentity.logo;

  // The active segment is whatever follows the skin base ("" for the Desk).
  // `useKeelSegments` strips a LEADING skin id rather than slicing a fixed
  // offset, so it is correct whether or not the pathname carries the prefix —
  // which is what makes this work unchanged on a LOCK_SKIN deploy.
  const segments = useKeelSegments();
  const restHead = segments[0] ?? "";
  // Highlight the parent nav entry for parameterized routes too:
  // knowledge/<docId> keeps "Register" active.
  const isActive = (segment: string) =>
    segment === "" ? restHead === "" : restHead === segment;

  // ── BEAT 3b, part 1 — the ROUTE readable ──────────────────────────────────
  // Without this the agent has no idea which page is open, so "what's on my
  // screen?" answers identically everywhere no matter how good the per-page
  // readables are. It lives in the layout because the layout is the one
  // component mounted on every route, including both parameterized ones — and
  // `detail_id` is what lets the agent say WHICH document or run is open rather
  // than only that a detail page is.
  //
  // Deliberately narrow: it names the route and nothing about the contents. Each
  // page describes its own contents (`pages/knowledge.tsx`,
  // `pages/document.tsx`), and a layout that also summarized them would be a
  // second, staler opinion about the same screen.
  //
  // No semicolons in the description — the repo's readable omission guards
  // anchor on a `useAgentContext(` window terminated by the statement's own
  // semicolon.
  const navLabel = keelNav.find((route) => isActive(route.segment))?.label;
  useAgentContext({
    description:
      "The page the operator is looking at right now in Keel — the route below " +
      "the app root, the nav entry that is highlighted, and the id of the " +
      "record open on a detail route. Treat this as your knowledge of WHERE " +
      "the operator is, and never say you cannot see the screen.",
    value: JSON.stringify({
      path: segments.join("/"),
      section: navLabel ?? restHead ?? "",
      // "knowledge/<docId>" and "runs/<runId>" are the two parameterized routes
      // — keel is the only skin with any, and this is the field that makes them
      // legible to the agent.
      detail_id: segments[1] ?? null,
      persona: data.persona.name,
      persona_role: data.persona.role,
    }),
  });

  const awaiting = data.approvalsForMe.length;

  return (
    // `h-full`, not `min-h-screen`: this chrome now fills the shell's app card,
    // which is already inset by the frame padding — sizing to the viewport would
    // overflow the card by exactly that padding.
    <div className="flex h-full bg-canvas text-ink">
      {/* Left nav rail */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-hairline bg-surface px-3 py-5 md:flex">
        <Link
          href={keelHref()}
          className="mb-6 flex items-center gap-2.5 px-2"
          aria-label={keelIdentity.brand}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-brand text-brand-foreground">
            <Logo className="h-5 w-5" />
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-bold text-ink">
              {keelIdentity.brand}
            </span>
            <span className="block text-[11px] text-ink-muted">
              Harbor Point Health
            </span>
          </span>
        </Link>

        <nav className="flex flex-col gap-0.5">
          {keelNav.map((route) => {
            const href = keelHref(route.segment);
            const active = isActive(route.segment);
            const Icon = route.icon ?? NAV_ICONS[route.segment] ?? Activity;
            return (
              <Link
                key={route.segment || "index"}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-brand-soft text-brand"
                    : "text-ink-muted hover:bg-surface-muted hover:text-ink",
                )}
              >
                <Icon className="h-4 w-4" />
                {route.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto rounded-md bg-surface-muted p-3 text-xs leading-relaxed text-ink-muted">
          Ask what the policy says — or hand Keel the work.
        </div>
      </aside>

      {/* Main region */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between gap-4 border-b border-hairline bg-surface px-4 md:px-6">
          <div className="flex items-center gap-2 text-brand">
            <Logo className="h-5 w-5" />
            <span className="text-sm font-semibold tracking-tight text-ink">
              {keelIdentity.brand}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Awaiting-approval count. --brand-violet is Keel's amber attention
                accent (see theme.css) — the workflow-attention slot. */}
            <div className="hidden items-center gap-2 sm:flex">
              <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                Awaiting you
              </span>
              <span
                className={cn(
                  "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold",
                  awaiting > 0
                    ? "bg-brand-violet/15 text-brand-violet"
                    : "bg-surface-muted text-ink-muted",
                )}
                aria-label={`${awaiting} runs awaiting your approval`}
              >
                {awaiting}
              </span>
            </div>
            <RoleSwitcher />
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto px-4 py-6 md:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}

export default KeelLayout;
