"use client";

// @region[support-tickets]
// Mock tickets the "operator" is working through. Hard-coded so the
// agent has real-looking data to reference when asked to take an action.
export const SUPPORT_TICKETS = [
  {
    id: "#12345",
    customer: "Jordan Rivera",
    subject: "Refund request — duplicate charge",
    status: "Open",
    amount: 50,
  },
  {
    id: "#12346",
    customer: "Priya Shah",
    subject: "Downgrade plan to Starter",
    status: "Open",
    amount: 0,
  },
  {
    id: "#12347",
    customer: "Morgan Lee",
    subject: "Escalate: payment stuck in pending",
    status: "Escalating",
    amount: 0,
  },
];
// @endregion[support-tickets]

export function TicketsPanel() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-gray-200 bg-white px-6 py-4 dark:border-border dark:bg-card">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-muted-foreground">
          Support Inbox
        </div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-foreground">
          Open tickets
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-muted-foreground">
          Ask the copilot to take an action. Every customer-affecting action
          will pop up an approval dialog here in the app — outside the chat.
        </p>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <ul className="space-y-3">
          {SUPPORT_TICKETS.map((t) => (
            <li
              key={t.id}
              data-testid={`ticket-${t.id.replace("#", "")}`}
              className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-border dark:bg-card"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-gray-500 dark:text-muted-foreground">
                  {t.id}
                </span>
                <span
                  className={
                    t.status === "Escalating"
                      ? "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                      : "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-950/40 dark:text-green-300"
                  }
                >
                  {t.status}
                </span>
              </div>
              <div className="mt-2 text-sm font-semibold text-gray-900 dark:text-foreground">
                {t.customer}
              </div>
              <div className="text-sm text-gray-700 dark:text-foreground">
                {t.subject}
              </div>
              {t.amount > 0 && (
                <div className="mt-2 text-xs text-gray-500 dark:text-muted-foreground">
                  Disputed amount: ${t.amount.toFixed(2)}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
