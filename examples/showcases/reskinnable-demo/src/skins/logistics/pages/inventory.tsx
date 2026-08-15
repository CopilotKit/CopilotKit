"use client";

import { useMemo } from "react";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { useLogistics } from "../actions";
import { InventoryRiskList, orderInventoryRows } from "../components";

export function InventoryPage() {
  const { inventory } = useLogistics();

  // ONE array, two consumers — see control-tower.tsx for why.
  const visible = useMemo(() => orderInventoryRows(inventory), [inventory]);

  // BEAT 3b — `visible` is the exact array <InventoryRiskList> maps over below,
  // in the exact order it paints. The page header reads "Inventory at Risk", so
  // the readable says the same thing the planner sees at the top of the screen.
  useAgentContext({
    description:
      "What is on the Inventory at Risk screen right now: the SKU cards the " +
      "planner can actually see, in the order shown, with their days of cover " +
      "and risk flag.",
    value: JSON.stringify({
      page: "Inventory at Risk",
      visible: visible.length,
      at_risk: visible.filter((i) => i.atRisk).length,
      rows: visible.map((i) => ({
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
      <InventoryRiskList items={visible} />
    </div>
  );
}

export default InventoryPage;
