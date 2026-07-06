"use client";

import { useEffect } from "react";
import Link from "next/link";
import {
  CreditCard,
  HelpCircle,
  LayoutDashboard,
  RotateCcw,
  Telescope,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Member } from "@/app/api/v1/data";
import { MemberRole } from "@/app/api/v1/data";
import { useAuthContext } from "@/components/auth-context";
import { useGlassEngine } from "@/components/glass-engine-context";
import { useRecording } from "@/components/recording-context";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { usePathname } from "next/navigation";
import { IDENTITY } from "@/lib/identity";
import { useCanvas } from "@/components/canvas/canvas-context";
import { ReportCanvas } from "@/components/canvas/report-canvas";

interface LayoutProps {
  children: React.ReactNode;
  resetEnabled?: boolean;
}

/** Compact violet→indigo logo mark used at the top of the floating rail. */
function BrandMark() {
  return (
    <span className="brand-gradient flex h-11 w-11 items-center justify-center rounded-2xl text-surface shadow-[0_8px_20px_hsl(252_83%_60%/0.4)]">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className="h-6 w-6"
        aria-hidden="true"
      >
        <path
          d="M4 13.5L9 7l4 4.5L20 4"
          stroke="white"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="20" cy="4" r="2" fill="white" />
      </svg>
    </span>
  );
}

function UserNavigation({
  availableUsers,
  currentUser,
  onChangeUser,
}: {
  availableUsers: Member[];
  currentUser: Member;
  onChangeUser: (user: Member) => void;
}) {
  const getInitials = (name: string) => {
    return (name || "X Y")
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase();
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 rounded-2xl p-0 hover:bg-brand-soft"
          aria-label="Account menu"
        >
          <Avatar className="h-9 w-9">
            <AvatarFallback>{getInitials(currentUser.name)}</AvatarFallback>
          </Avatar>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="end" side="right">
        <div className="grid gap-4">
          <div className="space-y-1">
            <h4 className="font-semibold leading-none text-ink">
              {currentUser.name}
            </h4>
            <p className="text-xs text-ink-muted">{currentUser.email}</p>
          </div>
          <div className="grid gap-1">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Switch user
            </h4>
            {availableUsers.map((user) => (
              <Button
                key={user.id}
                variant="ghost"
                className="w-full justify-start gap-2 px-2"
                onClick={() => onChangeUser(user)}
              >
                <Avatar className="h-6 w-6">
                  <AvatarFallback className="text-[0.6rem]">
                    {getInitials(user.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate text-sm">
                  {user.name} (
                  {user.role === MemberRole.Admin
                    ? user.role
                    : user.role == MemberRole.Assistant
                      ? user.team + " " + user.role
                      : user.team}
                  )
                </span>
              </Button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function LayoutComponent({
  children,
  resetEnabled = false,
}: LayoutProps) {
  const { users, currentUser, setCurrentUser } = useAuthContext();
  const {
    available: glassAvailable,
    active: glassActive,
    toggle: toggleGlass,
  } = useGlassEngine();
  const pathname = usePathname();
  useAgentContext({
    description: "The current page where the user is",
    value: pathname.split("/")[1] === "" ? "cards" : pathname.split("/")[1],
  });
  const { activeSurfaceId, clear } = useCanvas();

  const handleReset = async () => {
    // Native confirm keeps the booth tool dependency-free and reliable; a stray
    // click can't nuke the demo mid-show.
    if (
      !window.confirm(
        "Reset demo state? This clears all learned memories and restores pending charges.",
      )
    ) {
      return;
    }
    try {
      const res = await fetch("/api/v1/dev/reset", { method: "POST" });
      if (res.ok) {
        // Full reload -> pristine client slate (fresh transactions, cleared
        // canvas, new thread on next message).
        window.location.reload();
      } else {
        window.alert(`Reset failed (HTTP ${res.status}). See the server logs.`);
      }
    } catch (err) {
      window.alert(`Reset failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  // Navigating via the rail dismisses any stale surface.
  useEffect(() => {
    clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <div
      className={cn(
        "flex h-screen overflow-hidden bg-canvas transition-[padding] duration-300",
        glassActive && "md:pr-96",
      )}
    >
      {/* Floating icon rail. */}
      <div className="flex flex-shrink-0 flex-col py-4 pl-4">
        <aside className="glass-surface flex h-full w-[72px] flex-col items-center rounded-[28px] border border-white/60 px-2 py-5 shadow-lift dark:border-hairline">
          <Link
            href="/"
            className="flex items-center justify-center"
            aria-label={IDENTITY.brand}
          >
            <BrandMark />
          </Link>
          <nav className="mt-8 flex flex-1 flex-col items-center gap-3">
            <NavItem
              href="/dashboard"
              icon={LayoutDashboard}
              label="Dashboard"
              active={pathname.startsWith("/dashboard")}
            />
            <NavItem
              href="/"
              icon={CreditCard}
              label="Credit Cards"
              active={pathname === "/" || pathname.startsWith("/cards")}
            />
            {currentUser.role === MemberRole.Admin ? (
              <NavItem
                href="/team"
                icon={Users}
                label="Team Management"
                active={pathname.startsWith("/team")}
              />
            ) : null}
          </nav>
          <div className="flex flex-col items-center gap-3">
            {resetEnabled && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleReset}
                      aria-label="Reset demo state"
                      className="flex h-10 w-10 items-center justify-center rounded-2xl text-ink-muted transition-colors hover:bg-brand-soft hover:text-brand-indigo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                    >
                      <RotateCcw className="h-5 w-5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <p>Reset demo state</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {glassAvailable && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={toggleGlass}
                      aria-pressed={glassActive}
                      aria-label="Glass Engine"
                      className={cn(
                        "hidden h-10 w-10 items-center justify-center rounded-2xl transition-all md:flex",
                        glassActive
                          ? "brand-gradient text-surface shadow-[0_8px_18px_hsl(252_83%_60%/0.4)]"
                          : "text-ink-muted hover:bg-brand-soft hover:text-brand-indigo",
                      )}
                    >
                      <Telescope className="h-5 w-5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <p>Glass Engine (advanced)</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <ThemeToggle />
            <UserNavigation
              availableUsers={users}
              currentUser={currentUser}
              onChangeUser={setCurrentUser}
            />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Help"
                    className="flex h-10 w-10 items-center justify-center rounded-2xl text-ink-muted transition-colors hover:bg-brand-soft hover:text-brand-indigo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                  >
                    <HelpCircle className="h-5 w-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>Help &amp; support</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </aside>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-20 items-center justify-between px-6 md:px-10">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {IDENTITY.brand}
            </p>
            <h1 className="text-2xl font-bold tracking-tight text-ink">
              Hello, {currentUser.name.split(" ")[0]}
            </h1>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto px-2 pb-6 md:px-6">
          {activeSurfaceId ? (
            <div className="flex h-full flex-1 flex-col">
              <div className="flex items-center gap-2 p-4">
                <button
                  type="button"
                  onClick={clear}
                  className="inline-flex items-center gap-1 rounded-xl border border-hairline bg-surface px-3 py-1.5 text-sm text-ink shadow-soft"
                >
                  ← Back to {pathname.split("/")[1] || "dashboard"}
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <ReportCanvas />
              </div>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}

interface NavItemProps {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
}

function NavItem({ href, icon: Icon, label, active = false }: NavItemProps) {
  // Narrate nav clicks into the recorder HUD — a no-op unless a workflow is
  // being recorded, so it only fires while the officer is demonstrating.
  const { logStep } = useRecording();
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={href}
            onClick={() => logStep(`Opened ${label}`)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex h-11 w-11 items-center justify-center rounded-2xl transition-all duration-200",
              active
                ? "brand-gradient text-surface shadow-[0_8px_18px_hsl(252_83%_60%/0.4)]"
                : "text-ink-muted hover:bg-brand-soft hover:text-brand-indigo",
            )}
          >
            <Icon className="h-5 w-5" />
            <span className="sr-only">{label}</span>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
