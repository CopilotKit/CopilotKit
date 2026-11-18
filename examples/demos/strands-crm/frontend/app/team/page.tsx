"use client";
import { useCrmContext } from "@/components/crm-context";
import { RepCard } from "@/components/team/RepCard";
import { TeamLeaderboard } from "@/components/team/TeamLeaderboard";
import { Skeleton } from "@/components/ui/skeleton";
import { repStats } from "@/lib/crm";

export default function TeamPage() {
  const { crm, loading } = useCrmContext();
  const reps = crm.salespeople
    .map((s) => repStats(crm, s.id))
    .filter((r): r is NonNullable<typeof r> => r !== null);

  return (
    <div className="h-full overflow-auto p-6">
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Team</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Sales-rep leaderboard and per-rep performance.
          </p>
        </div>

        {loading ? (
          <div className="space-y-6">
            <Skeleton className="h-40 w-full rounded-xl" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-56 w-full rounded-xl" />
              ))}
            </div>
          </div>
        ) : reps.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No sales reps yet.
          </div>
        ) : (
          <>
            <TeamLeaderboard crm={crm} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {reps.map((stats) => (
                <RepCard key={stats.rep.id} stats={stats} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
