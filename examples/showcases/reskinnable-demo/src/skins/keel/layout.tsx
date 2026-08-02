"use client";

// Side-effect import: loads the .theme-keel token block whenever the keel skin's
// chrome mounts. Without it the skin renders unthemed. (The shell applies the
// `theme-keel` class higher up; this import supplies its values.)
import "./theme.css";

import { useEffect } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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

const BASE = "/keel";

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
  const pathname = usePathname();
  const Logo = keelIdentity.logo;

  // The active segment is whatever follows the skin base ("" for the Desk).
  const restHead = pathname.split("/").slice(2)[0] ?? "";
  // Highlight the parent nav entry for parameterized routes too:
  // /keel/knowledge/<docId> keeps "Knowledge" active.
  const isActive = (segment: string) =>
    segment === "" ? restHead === "" : restHead === segment;

  const awaiting = data.approvalsForMe.length;

  // Publish this skin's edge-nav geometry so the shell's floating skin selector
  // can inset its dock clear of the nav WITHOUT the shell knowing anything about
  // keel (see `.nw-selector-dock` in globals.css). Keel pins a 224px (w-56) rail
  // to the LEFT and nothing to the right. Published on <html> so the fixed dock,
  // wherever it sits in the tree, inherits the values.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--nw-nav-inset-left", "224px");
    root.style.setProperty("--nw-nav-inset-right", "0px");
    return () => {
      root.style.removeProperty("--nw-nav-inset-left");
      root.style.removeProperty("--nw-nav-inset-right");
    };
  }, []);

  return (
    <div className="flex h-full min-h-screen bg-canvas text-ink">
      {/* Left nav rail */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-hairline bg-surface px-3 py-5 md:flex">
        <Link
          href={BASE}
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
            const href = route.segment ? `${BASE}/${route.segment}` : BASE;
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
