"use client";
import { Search, Plus } from "lucide-react";
import { usePathname } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/pipeline": "Pipeline",
  "/products": "Products",
  "/accounts": "Accounts",
  "/contacts": "Contacts",
  "/team": "Team",
  "/reports": "Reports",
  "/reports/weekly": "Weekly Reports",
  "/reports/team": "Team Reports",
  "/activity": "Activity",
};

export function TopBar() {
  const pathname = usePathname();
  const title =
    TITLES[pathname] ??
    (pathname.startsWith("/quotes") ? "Quote" : "Dashboard");
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-card px-6">
      <h1 className="text-sm font-semibold">{title}</h1>
      <div className="relative ml-2 hidden max-w-sm flex-1 items-center sm:flex">
        <Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search deals, accounts, contacts…"
          className="pl-9"
          disabled
        />
      </div>
      <div className="ml-auto flex items-center gap-3">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>
                <Button size="sm" disabled className="gap-1.5">
                  <Plus className="h-4 w-4" /> New deal
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>Coming soon</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Avatar className="h-8 w-8">
          <AvatarFallback>NB</AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
