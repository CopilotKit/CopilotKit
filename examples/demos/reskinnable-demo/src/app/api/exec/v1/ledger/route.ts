import * as store from "@/skins/exec/data/store";
import { buildBlockOps } from "@/skins/exec/blocks/build-block-ops";
import type { DashboardBlock } from "@/skins/exec/data/types";

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
/**
 * One stored block, enriched with the ops the grid renders it from.
 *
 * NEVER THROWS. `buildBlockOps` does — `assertValidBlockSpec` rejects a spec
 * that cannot render (unknown kind, metric-bound kind with no metricId, a
 * metricId outside the catalog, a bad `months`) — and nothing guarantees the
 * STORED specs are all valid: `createDraftBlock` and the agent's
 * `render_metric_block` both screen what they write, but the seeds construct
 * blocks directly, and a spec that was renderable when it was pinned stops
 * being so the moment the catalog moves under it.
 *
 * Unguarded, that one throw escaped the handler and 500'd the WHOLE snapshot
 * — every dashboard, the metrics, the narratives, the packs. And a 500 here
 * is not one broken card: the provider's first-load gate
 * (`skins/exec/data/ledger-context.tsx`) renders its error panel INSTEAD of
 * children, above the chat and the frontend tools, so a single unrenderable
 * block took out the chat and the very grid the operator would have used to
 * unpin it — with no way back short of a server restart.
 *
 * So the failure is scoped to its own block: no ops, and `opsError` saying
 * why. The block is KEPT rather than dropped because the grid's card chrome
 * (title, remove, move) is drawn by `components/dashboard-grid.tsx` around
 * the ops, not by them — so a block that carries none still renders a card
 * the operator can unpin, where a dropped one would be invisible and
 * unremovable while going on breaking every later read. Logged loudly too:
 * this is a bug in whatever wrote the spec, and it must not pass in silence.
 */
const withOps = (block: DashboardBlock) => {
  try {
    return {
      ...block,
      ops: buildBlockOps(block.spec, block.id, { pinned: true }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[exec] ledger: block ${block.id} has an unrenderable spec, serving it with no ops`,
      error,
    );
    return { ...block, ops: [], opsError: message };
  }
};

export const GET = async () => {
  const snapshot = store.snapshot();
  return Response.json(
    {
      ...snapshot,
      dashboards: Object.fromEntries(
        Object.entries(snapshot.dashboards).map(([dashboardId, dashboard]) => [
          dashboardId,
          { ...dashboard, blocks: dashboard.blocks.map(withOps) },
        ]),
      ),
    },
    { headers: { "cache-control": "no-store" } },
  );
};
