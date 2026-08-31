"use client";
import { useCrmContext } from "@/components/crm-context";
import { Card } from "@/components/ui/card";
import { relativeTime } from "@/lib/crm";
import { StickyNote, Mail, Phone, Users } from "lucide-react";

const ICON = {
  note: StickyNote,
  email: Mail,
  call: Phone,
  meeting: Users,
} as const;

export default function ActivityPage() {
  const { crm, setSelectedDealId } = useCrmContext();
  const dealName = (id: string) => crm.deals.find((d) => d.id === id);
  const items = [...crm.activities].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );

  return (
    <div className="h-full overflow-auto p-6">
      <Card className="divide-y divide-border p-0">
        {items.map((a) => {
          const Icon = ICON[a.type] ?? StickyNote;
          const deal = dealName(a.dealId);
          const account =
            deal && crm.accounts.find((x) => x.id === deal.accountId);
          return (
            <button
              key={a.id}
              onClick={() => deal && setSelectedDealId(deal.id)}
              className="flex w-full items-start gap-3 p-3 text-left transition hover:bg-secondary/50"
            >
              <span className="mt-0.5 rounded-md bg-secondary p-1.5 text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm">{a.body}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {deal ? deal.name : "—"}
                  {account ? ` · ${account.name}` : ""} ·{" "}
                  {relativeTime(a.createdAt)}
                </div>
              </div>
            </button>
          );
        })}
      </Card>
    </div>
  );
}
