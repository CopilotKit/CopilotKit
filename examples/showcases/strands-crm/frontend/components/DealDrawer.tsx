"use client";
import { useEffect } from "react";
import { X, ChevronDown } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { formatCurrency, STAGES, STAGE_STYLES } from "@/lib/crm";
import type { CrmState, Stage } from "@/lib/crm";
import { cn } from "@/lib/utils";
import { AccountResearch } from "./AccountResearch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const TYPE_LABEL: Record<string, string> = {
  note: "Note",
  email: "Email",
  call: "Call",
  meeting: "Meeting",
};
const initials = (name: string) =>
  name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

// Contained slide-over: positioned absolutely within the (relative) <main>, so it
// overlays the board area only and never collides with the docked assistant panel
// to its right. Backdrop + Escape close it.
export function DealDrawer({
  crm,
  dealId,
  onOpenChange,
  onMoveStage,
}: {
  crm: CrmState;
  dealId: string | null;
  onOpenChange: (open: boolean) => void;
  onMoveStage?: (dealId: string, stage: Stage) => void;
}) {
  const deal = crm.deals.find((d) => d.id === dealId);
  const open = !!deal;
  const account = deal && crm.accounts.find((a) => a.id === deal.accountId);
  const contacts = deal
    ? crm.contacts.filter((c) => c.accountId === deal.accountId)
    : [];
  const activities = deal
    ? crm.activities.filter((a) => a.dealId === deal.id)
    : [];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  return (
    <>
      <div
        aria-hidden
        onClick={() => onOpenChange(false)}
        className={cn(
          "absolute inset-0 z-10 bg-foreground/10 transition-opacity duration-200",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <aside
        role="dialog"
        aria-modal="false"
        aria-hidden={!open}
        className={cn(
          "absolute inset-y-0 right-0 z-20 flex w-[420px] max-w-[88%] flex-col border-l border-border bg-card shadow-xl transition-transform duration-200",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        {deal && account && (
          <div className="flex h-full flex-col overflow-y-auto">
            <div className="flex items-start justify-between gap-2 border-b border-border p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-base font-semibold">
                    {deal.name}
                  </h2>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      STAGE_STYLES[deal.stage],
                    )}
                  >
                    {deal.stage}
                  </span>
                  {onMoveStage && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground transition hover:bg-secondary">
                          Move <ChevronDown className="h-3 w-3" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {STAGES.map((s) => (
                          <DropdownMenuItem
                            key={s}
                            disabled={s === deal.stage}
                            onSelect={() => onMoveStage(deal.id, s)}
                          >
                            {s}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {account.name}
                  {account.industry ? ` · ${account.industry}` : ""}
                </p>
              </div>
              <button
                onClick={() => onOpenChange(false)}
                aria-label="Close"
                className="shrink-0 rounded-md p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-6 p-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <div className="text-xs text-muted-foreground">Amount</div>
                  <div className="font-semibold tabular-nums">
                    {formatCurrency(deal.amount)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">
                    Probability
                  </div>
                  <div className="font-semibold tabular-nums">
                    {deal.probability}%
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Close</div>
                  <div className="font-semibold tabular-nums">
                    {deal.closeDate}
                  </div>
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                Owner: {deal.ownerName}
              </div>

              <Section title="Contacts">
                <ul className="space-y-2">
                  {contacts.map((c) => (
                    <li key={c.id} className="flex items-center gap-2 text-sm">
                      <Avatar className="h-7 w-7">
                        <AvatarFallback className="text-[10px]">
                          {initials(c.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span>
                        {c.name}{" "}
                        <span className="text-muted-foreground">
                          · {c.title}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>

              <Section title="Activity">
                <ol className="space-y-3 border-l border-border pl-4">
                  {activities.map((a) => (
                    <li key={a.id} className="relative text-sm">
                      <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-primary" />
                      <div className="text-xs font-medium text-muted-foreground">
                        {TYPE_LABEL[a.type] ?? a.type}
                      </div>
                      <div>{a.body}</div>
                    </li>
                  ))}
                </ol>
              </Section>

              <Section title="Account research">
                <AccountResearch
                  enrichment={account.enrichment}
                  accountName={account.name}
                />
              </Section>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
