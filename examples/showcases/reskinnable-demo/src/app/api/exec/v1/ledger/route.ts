import * as store from "@/skins/exec/data/store";
import { buildBlockOps } from "@/skins/exec/blocks/build-block-ops";

/**
 * The whole ledger in one read.
 *
 * Mirrors people's `/api/people/v1/ledger`: every dashboard-carrying surface
 * here — the CEO/CFO pages, the agent's readables — needs the same instant of
 * metrics, initiatives, narratives and packs, so one snapshot keeps the page
 * self-consistent for the "what's on my screen" beat rather than letting N
 * separate fetches race each other.
 *
 * Each block is enriched with its A2UI ops here (not stored on the block)
 * because ops are a rendering of `spec`, derived fresh on every read; `pinned:
 * true` is correct for every block returned by this route since nothing not
 * on a dashboard reaches `snapshot().dashboards`.
 */
export const GET = async () => {
  const snapshot = store.snapshot();
  return Response.json({
    ...snapshot,
    dashboards: Object.fromEntries(
      Object.entries(snapshot.dashboards).map(([dashboardId, dashboard]) => [
        dashboardId,
        {
          ...dashboard,
          blocks: dashboard.blocks.map((block) => ({
            ...block,
            ops: buildBlockOps(block.spec, block.id, { pinned: true }),
          })),
        },
      ]),
    ),
  });
};
