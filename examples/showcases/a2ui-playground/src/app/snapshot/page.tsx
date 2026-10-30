"use client";

import { useEffect, useState } from "react";
import { StaticSurface } from "@/components/app/static-surface";
import type { A2UIOp } from "@/lib/run-store";

/** Test utility (unlinked): renders the ops stored under localStorage "a2ui-snapshot" at full height, for screenshots. */
export default function SnapshotPage() {
  const [ops, setOps] = useState<A2UIOp[] | null>(null);
  useEffect(() => {
    try {
      setOps(JSON.parse(localStorage.getItem("a2ui-snapshot") ?? "null"));
    } catch {
      setOps(null);
    }
  }, []);
  return (
    <main className="pg-root min-h-[100dvh] py-8">
      <div className="mx-auto w-full max-w-[760px] px-6" data-snapshot>
        {ops ? <StaticSurface ops={ops} /> : <p className="text-[13px] text-muted-foreground">No snapshot stored.</p>}
      </div>
    </main>
  );
}
