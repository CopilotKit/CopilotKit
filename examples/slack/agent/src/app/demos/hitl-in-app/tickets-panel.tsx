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
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
          Support Inbox
        </div>
        <h1 className="text-xl font-semibold text-gray-900">Open tickets</h1>
        <p className="mt-1 text-sm text-gray-600">
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
              className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-gray-500">{t.id}</span>
                <span
                  className={
                    t.status === "Escalating"
                      ? "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                      : "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800"
                  }
                >
                  {t.status}
                </span>
              </div>
              <div className="mt-2 text-sm font-semibold text-gray-900">
                {t.customer}
              </div>
              <div className="text-sm text-gray-700">{t.subject}</div>
              {t.amount > 0 && (
                <div className="mt-2 text-xs text-gray-500">
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
