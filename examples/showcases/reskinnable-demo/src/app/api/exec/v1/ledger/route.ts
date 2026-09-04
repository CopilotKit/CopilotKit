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
 *
 * `no-store`, like this skin's budget-memo route: every mutation on stage —
 * filing a narrative, pinning a block, publishing a pack — is followed by a
 * re-read of this route, and a cached copy answers with the snapshot from
 * BEFORE the mutation. The client asks with `cache: "no-store"` already (see
 * `skins/exec/data/ledger-context.tsx`), but that governs the browser's cache
 * only; nothing tells Next's route-handler cache, a CDN in front of a booth
 * deploy, or a browser heuristic on a header-less 200 not to keep it.
 */
export const GET = async () => {
  const snapshot = store.snapshot();
  return Response.json(
    {
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
    },
    { headers: { "cache-control": "no-store" } },
  );
};
