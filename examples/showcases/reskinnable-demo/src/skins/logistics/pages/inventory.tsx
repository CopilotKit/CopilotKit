"use client";

import { useLogistics } from "../actions";
import { InventoryRiskList } from "../components";

export function InventoryPage() {
  const { inventory } = useLogistics();
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Inventory at Risk
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Days of cover against inbound arrivals.
        </p>
      </header>
      <InventoryRiskList items={inventory} />
    </div>
  );
}

export default InventoryPage;
