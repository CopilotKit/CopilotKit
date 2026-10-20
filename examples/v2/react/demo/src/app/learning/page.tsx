"use client";

import Link from "next/link";
import { DEALS } from "@/lib/deals";

/** No chat on this page: clicks here are the "no Thread" case. */
export default function DealsPage() {
  return (
    <section className="max-w-2xl">
      <h1 className="mb-1 text-2xl font-semibold">Deals</h1>
      <p className="mb-6 text-sm text-gray-500">
        No chat on this page, so clicks here carry <code>threadId: null</code>.
      </p>
      <ul className="divide-y rounded border">
        {DEALS.map((deal) => (
          <li key={deal.id} className="flex items-center justify-between p-4">
            <div>
              <div className="font-medium">{deal.name}</div>
              <div className="text-sm text-gray-500">
                ${deal.amount.toLocaleString("en-US")} · {deal.stage}
              </div>
            </div>
            <Link
              href={`/learning/deals/${deal.id}`}
              data-copilotkit-action="deal.open"
              className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white"
            >
              Open
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
