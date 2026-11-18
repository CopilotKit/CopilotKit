import * as store from "@/skins/ledgerline/data/store";
import type { ReportStatus } from "@/skins/ledgerline/data/types";

export const dynamic = "force-dynamic";
export const GET = (req: Request) => {
  const p = new URL(req.url).searchParams;
  return Response.json(
    store.listReports({
      status: (p.get("status") as ReportStatus | "all" | null) ?? "all",
      employee: p.get("employee") ?? undefined,
      q: p.get("q") ?? undefined,
    }),
  );
};
