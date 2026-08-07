"use client";

import type { Lens } from "../../data/types";
import { useSeries } from "../../data/hooks";
import { WaterfallChart } from "../charts/waterfall-chart";
import { CardShell } from "./card-shell";

export function WaterfallCard({
  lens,
  title,
  note,
}: {
  lens: Lens;
  title?: string;
  note?: string;
}) {
  const { waterfall, loading } = useSeries(lens, "arr");
  return (
    <CardShell
      title={title ?? "Plan variance by region"}
      note={note}
      loading={loading}
    >
      <WaterfallChart steps={waterfall} unit="usd" />
    </CardShell>
  );
}
