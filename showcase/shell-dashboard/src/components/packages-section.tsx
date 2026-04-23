"use client";
/**
 * Packages section: one row per package, each showing an L1-L4 strip.
 * Packages have no feature breakdown (no /demos/* routing).
 */
import { useMemo } from "react";
import { getPackages, type Package } from "@/lib/registry";
import { mergeRowsToMap, type ConnectionStatus, type LiveStatusMap } from "@/lib/live-status";
import { useLiveStatus } from "@/hooks/useLiveStatus";
import { LevelStrip } from "@/components/level-strip";

/**
 * Adapter: LevelStrip expects an Integration-shaped object but packages
 * only have slug + name. Build a minimal compatible shape.
 */
function packageAsIntegration(pkg: Package) {
  return {
    slug: pkg.slug,
    name: pkg.name,
    category: "",
    language: "",
    description: "",
    repo: "",
    backend_url: "",
    deployed: true,
    features: [],
    demos: [], // no demos → Tools badge shows n/a
  };
}

function aggregateConnection(
  ...statuses: ConnectionStatus[]
): ConnectionStatus {
  if (statuses.some((s) => s === "error")) return "error";
  if (statuses.some((s) => s === "connecting")) return "connecting";
  return "live";
}

export function PackagesSection() {
  const packages = useMemo(() => getPackages(), []);

  const health = useLiveStatus("health");
  const agent = useLiveStatus("agent");
  const chat = useLiveStatus("chat");
  const tools = useLiveStatus("tools");

  const liveStatus: LiveStatusMap = useMemo(
    () => mergeRowsToMap(health.rows, agent.rows, chat.rows, tools.rows),
    [health.rows, agent.rows, chat.rows, tools.rows],
  );

  const connection = aggregateConnection(
    health.status,
    agent.status,
    chat.status,
    tools.status,
  );

  if (packages.length === 0) return null;

  return (
    <div className="px-8 pb-8" data-testid="packages-section">
      <h2 className="text-lg font-semibold tracking-tight mb-3">Packages</h2>
      {connection === "error" && (
        <div
          role="alert"
          className="mb-3 rounded-md border border-[var(--danger)] bg-[var(--bg-danger)] px-4 py-2 text-xs text-[var(--danger)]"
        >
          dashboard unavailable — check #oss-alerts
        </div>
      )}
      <div className="overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
        <table className="border-collapse text-sm w-full">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 bg-[var(--bg-muted)] px-4 py-2 text-left border-b border-[var(--border)]">
                <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                  Package
                </span>
              </th>
              <th className="bg-[var(--bg-muted)] px-4 py-2 text-left border-b border-l border-[var(--border)]">
                <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                  L1-L4 Status
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {packages.map((pkg) => (
              <tr
                key={pkg.slug}
                className="border-t border-[var(--border)] hover:bg-[var(--bg-hover)]"
              >
                <td className="sticky left-0 z-10 bg-[var(--bg-surface)] px-4 py-2 border-r border-[var(--border)]">
                  <span className="font-medium text-[var(--text)]">
                    {pkg.name}
                  </span>
                  <span className="ml-2 text-[10px] text-[var(--text-muted)]">
                    {pkg.slug}
                  </span>
                </td>
                <td className="px-4 py-2 border-l border-[var(--border)]">
                  <LevelStrip
                    integration={packageAsIntegration(pkg)}
                    liveStatus={liveStatus}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
