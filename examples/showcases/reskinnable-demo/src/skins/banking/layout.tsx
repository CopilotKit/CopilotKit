"use client";

// Side-effect import: loads the .theme-banking token block whenever the banking
// skin's chrome mounts. (The shell applies the `theme-banking` class higher up.)
import "./theme.css";

import { useEffect } from "react";
import Link from "next/link";
import { HelpCircle, RotateCcw } from "lucide-react";

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
import type { Member } from "@/skins/banking/data/data";
import { MemberRole } from "@/skins/banking/data/data";
import { useAuthContext } from "@/skins/banking/components/auth-context";
import { useRecording } from "@/shell/teach";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { usePathname, useSearchParams } from "next/navigation";
import { useSkin } from "@/shell/skin-provider";
import { useSkinHref, useSkinSegments } from "@/shell/skin-path";
import { usePresenterReset } from "@/shell/presenter-reset-context";
import { useCanvas } from "@/shell/canvas/canvas-context";
import { useAskCopilot } from "@/skins/banking/components/wow/use-ask-copilot";

/** Compact violet→indigo logo mark used at the top of the floating rail. */
function BrandMark({
  logo: Logo,
}: {
  logo: React.ComponentType<{ className?: string }>;
}) {
  return (
    <span className="brand-gradient flex h-11 w-11 items-center justify-center rounded-2xl text-surface shadow-[0_8px_20px_hsl(252_83%_60%/0.4)]">
      <Logo className="h-6 w-6" />
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
      <PopoverContent className="w-64" align="end" side="left">
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

export function LayoutComponent({ children }: { children: React.ReactNode }) {
  const skin = useSkin();
  const skinHref = useSkinHref(skin.id);
  const base = skinHref();
  const { users, currentUser, setCurrentUser } = useAuthContext();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const resetEnabled = usePresenterReset();
  const askCopilot = useAskCopilot();
  const { clear } = useCanvas();

  // The active segment is whatever follows the skin base ("" for the index).
  const restHead = useSkinSegments(skin.id)[0] ?? "";

  // Current-page readable, derived RELATIVE to the skin base so the agent is
  // told a real page. The skin index → "cards" (it IS the Credit Cards view),
  // `/dashboard` → "dashboard", etc. Before the cutover this read
  // pathname.split("/")[1], which reported the skin id under /[skin].
  useAgentContext({
    description: "The current page where the user is",
    value: restHead === "" ? "cards" : restHead,
  });

  const hrefFor = (segment: string) => skinHref(segment);
  const isActive = (segment: string) =>
    segment === ""
      ? restHead === "" || restHead === "cards"
      : restHead === segment;

  // Navigating dismisses any stale canvas surface. Watches the query string as
  // well as the pathname: the surface is derived from the LAST a2ui-surface
  // message and stays live until dismissed, and dashboard tabs are `?tab=` on
  // one pathname — so keying to pathname alone left a filed report covering the
  // page after an in-page tab switch.
  useEffect(() => {
    clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams?.toString()]);

  const handleReset = async () => {
    if (
      !window.confirm(
        "Reset demo state? This clears all learned memories and restores pending charges.",
      )
    ) {
      return;
    }
    try {
      const res = await fetch("/api/banking/v1/dev/reset", { method: "POST" });
      if (res.ok) {
        // Hard navigate to the skin root for a pristine client slate (fresh
        // transactions, cleared canvas, new thread on next message) AND the
        // clean starting URL the demo should always open on.
        window.location.assign(base);
      } else {
        window.alert(`Reset failed (HTTP ${res.status}). See the server logs.`);
      }
    } catch (err) {
      window.alert(`Reset failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  if (!currentUser) return null;

  return (
    <div className="flex h-full overflow-hidden bg-canvas transition-[padding] duration-300">
      {/*
        Floating icon rail — visually on the RIGHT, because the chat (thread
        rail + conversation) owns the left edge. Positioned with flex `order`
        rather than by moving the markup so the nav still precedes <main> in the
        DOM for screen readers and document order.
      */}
      <div className="order-2 flex flex-shrink-0 flex-col py-4 pr-4">
        <aside className="glass-surface flex h-full w-[72px] flex-col items-center rounded-[28px] border border-white/60 px-2 py-5 shadow-lift dark:border-hairline">
          <Link
            href={base}
            className="flex items-center justify-center"
            aria-label={skin.identity.brand}
          >
            <BrandMark logo={skin.identity.logo} />
          </Link>
          <nav className="mt-8 flex flex-1 flex-col items-center gap-3">
            {skin.nav.map((route) => {
              if (
                route.segment === "team" &&
                currentUser.role !== MemberRole.Admin
              ) {
                return null;
              }
              const Icon = route.icon ?? HelpCircle;
              return (
                <NavItem
                  key={route.segment || "index"}
                  href={hrefFor(route.segment)}
                  icon={Icon}
                  label={route.label}
                  active={isActive(route.segment)}
                />
              );
            })}
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
                  <TooltipContent side="left">
                    <p>Reset demo state</p>
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
            {/* Help opens the copilot with the question it exists to answer,
                which is also the only in-app help this demo has. */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Get help from the copilot"
                    onClick={() =>
                      void askCopilot(
                        "What can you help me with in this app? Give me a short list.",
                      )
                    }
                    className="flex h-10 w-10 items-center justify-center rounded-2xl text-ink-muted transition-colors hover:bg-brand-soft hover:text-brand-indigo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                  >
                    <HelpCircle className="h-5 w-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left">
                  <p>Ask the copilot for help</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </aside>
      </div>

      <div className="order-1 flex flex-1 flex-col overflow-hidden">
        <header className="flex h-20 items-center justify-between px-6 md:px-10">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {skin.identity.brand}
            </p>
            <h1 className="text-2xl font-bold tracking-tight text-ink">
              Hello, {currentUser.name.split(" ")[0]}
            </h1>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto px-2 pb-6 md:px-6">
          {children}
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
        <TooltipContent side="left">
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
