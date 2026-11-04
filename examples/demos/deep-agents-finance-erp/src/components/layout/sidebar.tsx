"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  LayoutGrid,
  FileText,
  Landmark,
  Package,
  Users,
  Settings,
  Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Dashboards", href: "/dashboards", icon: LayoutGrid },
  { name: "Invoices", href: "/invoices", icon: FileText },
  { name: "Accounts", href: "/accounts", icon: Landmark },
  { name: "Inventory", href: "/inventory", icon: Package },
  { name: "HR", href: "/hr", icon: Users },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-50 flex w-[72px] flex-col items-center border-r border-border bg-card py-4">
      <div className="mb-8 flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
        <Bot className="h-5 w-5 text-primary-foreground" />
      </div>

      <nav className="flex flex-1 flex-col items-center gap-1">
        {navigation.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "group relative flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-200",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <item.icon className="h-5 w-5" />
              <span className="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                {item.name}
              </span>
              {isActive && (
                <span className="absolute -left-[18px] h-5 w-1 rounded-r-full bg-primary" />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto">
        <button className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <Settings className="h-5 w-5" />
        </button>
      </div>
    </aside>
  );
}
