"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  LayoutGrid,
  Package,
  Building2,
  Users,
  UsersRound,
  Activity,
  BarChart3,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/Logo";
import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  children?: { label: string; href: string }[];
};

const NAV: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Pipeline", href: "/pipeline", icon: LayoutGrid },
  { label: "Products", href: "/products", icon: Package },
  { label: "Accounts", href: "/accounts", icon: Building2 },
  { label: "Contacts", href: "/contacts", icon: Users },
  { label: "Team", href: "/team", icon: UsersRound },
  {
    label: "Reports",
    href: "/reports",
    icon: BarChart3,
    children: [
      { label: "Weekly Reports", href: "/reports/weekly" },
      { label: "Team Reports", href: "/reports/team" },
    ],
  },
  { label: "Activity", href: "/activity", icon: Activity },
];

export function NavRail() {
  const pathname = usePathname();
  const { collapsed, toggle } = useSidebarCollapsed();
  const [reportsOpen, setReportsOpen] = useState(() =>
    pathname.startsWith("/reports"),
  );
  // Keep the Reports group open whenever the user is on one of its pages.
  useEffect(() => {
    if (pathname.startsWith("/reports")) setReportsOpen(true);
  }, [pathname]);
  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 md:flex",
          collapsed ? "w-[64px]" : "w-[220px]",
        )}
      >
        <div
          className={cn(
            "flex h-14 items-center",
            collapsed ? "justify-center px-0" : "px-4",
          )}
        >
          <Logo collapsed={collapsed} />
        </div>

        <nav
          className={cn(
            "flex flex-col gap-1 py-2",
            collapsed ? "px-2" : "px-3",
          )}
        >
          {NAV.map((item) => {
            const Icon = item.icon;

            // Expandable group (Reports) — only when the rail is expanded.
            if (item.children && !collapsed) {
              const parentActive = pathname === item.href;
              return (
                <div key={item.href}>
                  <div
                    className={cn(
                      "flex items-center rounded-md text-sm transition",
                      parentActive
                        ? "bg-accent font-medium text-accent-foreground"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                    )}
                  >
                    <Link
                      href={item.href}
                      aria-current={parentActive ? "page" : undefined}
                      className="flex flex-1 items-center gap-3 px-3 py-2"
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {item.label}
                    </Link>
                    <button
                      type="button"
                      aria-label={
                        reportsOpen
                          ? `Collapse ${item.label}`
                          : `Expand ${item.label}`
                      }
                      aria-expanded={reportsOpen}
                      onClick={() => setReportsOpen((o) => !o)}
                      className="px-2 py-2 text-muted-foreground transition hover:text-foreground"
                    >
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 transition-transform",
                          !reportsOpen && "-rotate-90",
                        )}
                      />
                    </button>
                  </div>

                  {reportsOpen && (
                    <div className="mt-1 ml-[1.05rem] flex flex-col gap-1 border-l border-border pl-3">
                      {item.children.map((child) => {
                        const childActive = pathname === child.href;
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            aria-current={childActive ? "page" : undefined}
                            className={cn(
                              "rounded-md px-3 py-1.5 text-sm transition",
                              childActive
                                ? "bg-accent font-medium text-accent-foreground"
                                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                            )}
                          >
                            {child.label}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            // Flat item (or collapsed rail): single row, tooltip when collapsed.
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            const link = (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition",
                  collapsed && "justify-center px-0",
                  active
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && item.label}
              </Link>
            );
            return collapsed ? (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            ) : (
              link
            );
          })}
        </nav>

        <div
          className={cn(
            "mt-auto flex flex-col gap-1 border-t border-border py-2",
            collapsed ? "px-2" : "px-3",
          )}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition hover:bg-secondary hover:text-foreground",
                  collapsed && "justify-center px-0",
                )}
              >
                <Settings className="h-4 w-4 shrink-0" />
                {!collapsed && "Settings"}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56">
              <DropdownMenuLabel>
                <div className="font-medium">Nathan Brooks</div>
                <div className="text-xs text-muted-foreground">
                  nathan@northstar.example
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled>Preferences</DropdownMenuItem>
              <DropdownMenuItem disabled>Theme: Light</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled>Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition hover:bg-secondary hover:text-foreground",
              collapsed && "justify-center px-0",
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4 shrink-0" />
            ) : (
              <>
                <PanelLeftClose className="h-4 w-4 shrink-0" /> Collapse
              </>
            )}
          </button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
