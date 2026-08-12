"use client";
import { useCrmContext } from "@/components/crm-context";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const initials = (name: string) =>
  name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export default function ContactsPage() {
  const { crm } = useCrmContext();
  const accountName = (id: string) =>
    crm.accounts.find((a) => a.id === id)?.name ?? "—";
  const rows = [...crm.contacts].sort((a, b) =>
    accountName(a.accountId).localeCompare(accountName(b.accountId)),
  );

  return (
    <div className="h-full overflow-auto p-6">
      <Card className="divide-y divide-border p-0">
        {rows.map((c) => (
          <div key={c.id} className="flex items-center gap-3 p-3">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="text-[11px]">
                {initials(c.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{c.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {c.title} · {accountName(c.accountId)}
              </div>
            </div>
            <a
              href={`mailto:${c.email}`}
              className="shrink-0 text-sm text-primary hover:underline"
            >
              {c.email}
            </a>
          </div>
        ))}
      </Card>
    </div>
  );
}
