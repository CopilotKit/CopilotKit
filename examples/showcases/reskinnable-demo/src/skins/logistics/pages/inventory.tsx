"use client";

import { useAgentContext } from "@copilotkit/react-core/v2";
import { useLogistics } from "../actions";
import { InventoryRiskList } from "../components";

export function InventoryPage() {
  const { inventory } = useLogistics();

  // BEAT 3b — `inventory` is the exact array <InventoryRiskList> maps over
  // below. The page header reads "Inventory at Risk", so the readable says the
  // same thing the planner sees at the top of the screen.
  useAgentContext({
    description:
      "What is on the Inventory at Risk screen right now: the SKU cards the " +
      "planner can actually see, with their days of cover and risk flag.",
    value: JSON.stringify({
      page: "Inventory at Risk",
      visible: inventory.length,
      at_risk: inventory.filter((i) => i.atRisk).length,
      rows: inventory.map((i) => ({
        sku: i.skuId,
        name: i.name,
        days_of_cover: i.daysOfCover,
        safety_stock_days: i.safetyStockDays,
        at_risk: i.atRisk,
        on_hand_units: i.onHandUnits,
        daily_demand: i.dailyDemand,
        inbound: i.inboundShipmentIds,
      })),
    }),
  });

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
