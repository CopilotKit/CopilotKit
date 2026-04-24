"use client";
/**
 * Packages section: one row per package, each showing an L1-L4 strip and
 * an achieved-depth column (D0-D4).
 */
import { useMemo } from "react";
import { getPackages, type Package } from "@/lib/registry";
import { keyFor, type ConnectionStatus, type LiveStatusMap } from "@/lib/live-status";
import { LevelStrip } from "@/components/level-strip";
import { DepthChip } from "@/components/depth-chip";

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
    demos: [], // no demos -> Tools badge shows n/a
  };
}

/**
 * Derive a simple integration-scoped depth for a package row.
 * Packages don't have per-feature e2e data, so D3 is skipped.
 * D0 = exists, D1 = health green, D2 = agent green, D4 = chat|tools green.
 */
function derivePackageDepth(
  slug: string,
  liveStatus: LiveStatusMap,
): 0 | 1 | 2 | 4 {
  const health = liveStatus.get(keyFor("health", slug));
  if (!health || health.state !== "green") return 0;

  const agent = liveStatus.get(keyFor("agent", slug));
  if (!agent || agent.state !== "green") return 1;

  const chat = liveStatus.get(keyFor("chat", slug));
  const tools = liveStatus.get(keyFor("tools", slug));
  if (
    (chat && chat.state === "green") ||
    (tools && tools.state === "green")
  ) {
    return 4;
  }

  return 2;
}

export interface PackagesSectionProps {
  /** Merged live-status map from all subscribed dimensions (lifted to page). */
  liveStatus: LiveStatusMap;
  /** Aggregated SSE connection status (lifted to page). */
  connection: ConnectionStatus;
}

export function PackagesSection({ liveStatus, connection }: PackagesSectionProps) {
  const packages = useMemo(() => getPackages(), []);

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
              <th className="bg-[var(--bg-muted)] px-4 py-2 text-center border-b border-l border-[var(--border)]">
                <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                  Depth
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {packages.map((pkg) => {
              const depth = derivePackageDepth(pkg.slug, liveStatus);
              return (
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
                  <td className="px-4 py-2 border-l border-[var(--border)] text-center">
                    <DepthChip depth={depth} status="wired" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
