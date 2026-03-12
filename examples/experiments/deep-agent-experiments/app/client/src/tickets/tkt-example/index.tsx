import type { TicketMeta } from "../lib/ticket-types";

export const meta: TicketMeta = {
  title: "Calendar widget doesn't load for enterprise accounts",
  refs: [
    "https://app.getorca.ai/tickets/TKT-example?status=open&account=68386015b3522d6393dca6d0",
    "https://discord.com/channels/xxx/yyy/zzz",
  ],
  notes: "Happens only when the account has >50 team members. Related to pagination bug.",
};

export default function TKTexample() {
  return (
    <div className="p-4">
      <p className="text-gray-500 italic">
        Reproduction sandbox — implement the issue reproduction here.
      </p>
    </div>
  );
}
