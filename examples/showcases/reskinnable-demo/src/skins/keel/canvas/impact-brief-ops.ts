import { z } from "zod";
import { canonicalRef } from "@/skins/keel/data/bulletin-citations";
import type { ImpactBrief } from "@/skins/keel/data/types";

/**
 * BEAT 3d — the deterministic A2UI op-builder that puts a FILED Impact Brief on
 * the shared canvas.
 *
 * SERVER-SAFE: no React, no JSX, no "use client", no .tsx imports. A later slot
 * imports it from `agent.ts` for a `render_impact_brief` tool, the same way
 * `ops-report.ts` is imported for `render_ops_report`.
 *
 * WIRED by the `render_impact_brief` server tool in `agent.ts`, which looks the
 * record up with `store.impactBriefs().find(…)` and emits
 * `buildImpactBriefOps(brief, store.refsOnFile())`. `agent.test.ts` is the drift
 * guard: `agent.ts` has no other one, and a tool defined but never added to the
 * `tools` array fails exactly once — on stage, as "the canvas never opened".
 *
 * ── WHY THE MODEL AUTHORS NOTHING THAT REACHES THIS CANVAS ───────────────────
 *
 * `ops-report.ts` keeps figures out of the ops because run KPIs MOVE: the agent
 * picks WHICH tiles, the renderers read live `useKeelDesk()`, so the canvas
 * cannot show yesterday's number. A filed Impact Brief is the opposite
 * kind of fact — it is IMMUTABLE the instant `POST /briefs` returns, and it is
 * durable on the server whether or not this thread survives. So its values are
 * expanded into the ops here, read out of the stored record.
 *
 * That is not the discipline being relaxed; it is the same discipline reaching
 * the same answer from the other side. The tool's parameters carry a `briefId`
 * and NOTHING ELSE (see below), so every string that lands on this canvas came
 * out of the store, not out of the model's second telling of what it just filed.
 * A `summary` parameter here would let the brief on the canvas and the brief on
 * the Register page say different things about the same document — the artifact
 * contradicting itself, which is worse than either being wrong alone.
 *
 * It also makes the surface REPLAY-SAFE (beat 2): the operations live in the
 * `a2ui-surface` activity, so a reloaded thread repaints this canvas with no
 * fetch and no store read at all.
 *
 * ── WHY `carried` IS COMPUTED HERE AND NOT STORED ────────────────────────────
 *
 * The brief's citations do not record whether the register carries each ref;
 * `POST /briefs` returns that as `settled` / `unmatched` at filing time and
 * keeps only the settled citation. Re-deriving it against the LIVE register at
 * render time is the honest reading — the claim "the library does not carry
 * POL-118" is a claim about the register NOW, and a reseed that adds POL-118
 * must be able to change the answer. It is also the one row this canvas exists
 * to draw: see `data/bulletin-citations.ts`.
 */

/** Must match the middleware's key so tryParseA2UIOperations detects the ops. */
export const A2UI_OPERATIONS_KEY = "a2ui_operations";

/**
 * The surface id the Impact Brief renders under.
 *
 * Deliberately NOT `SURFACE_ID` from `ops-report.ts` ("keel-ops-report"). The
 * a2ui provider keeps one surface per id, and re-using the ops report's would
 * make a filed brief overwrite the components of a report the presenter is
 * still looking at (and vice versa) inside a single conversation.
 */
export const IMPACT_BRIEF_SURFACE_ID = "keel-impact-brief";

/**
 * The catalog both keel canvas surfaces render through.
 *
 * MUST equal `REPORT_CATALOG_ID` in `ops-report.ts` and the `catalogId` of the
 * catalog created in `canvas-surface.tsx`, because `KeelCanvasSurface` mounts
 * ONE `A2UIProvider` for both surfaces. That constant is private to
 * `ops-report.ts`, so this is a second spelling of it —
 * `impact-brief-ops.test.ts` pins the two together against `buildOpsReportOps`'s
 * own emitted op rather than trusting the comment.
 */
const REPORT_CATALOG_ID = "keel-report";

/**
 * Parameters for the `render_impact_brief` tool.
 *
 * ONE FIELD, ON PURPOSE. Every other value on the canvas is read from the filed
 * record, so there is nothing here for the model to get wrong, over-fill or
 * quietly restate — the failure mode `POST /briefs` already had to defend
 * against in `currentRevision` (see that route's header).
 *
 * The wiring, as `agent.ts` now has it:
 *
 * ```ts
 * const brief = store.impactBriefs().find((b) => b.id === briefId);
 * // → if (!brief) tell the agent so; otherwise emit
 * buildImpactBriefOps(brief, store.refsOnFile());
 * ```
 */
export const renderImpactBriefParams = z.object({
  briefId: z
    .string()
    .describe(
      "The id returned by the tool that filed the impact brief. LABEL ONLY — " +
        "the canvas reads every figure, citation and date out of the filed " +
        "record, so do not restate the brief's contents anywhere in this call.",
    ),
});

type A2UIOp = Record<string, unknown> & { version?: string };
type Component = { id: string; component: string } & Record<string, unknown>;

/**
 * One cited policy as the canvas draws it.
 *
 * `carried` is the register's answer, not the bulletin's, and it is what tells
 * the two kinds of row apart on screen: a document Harbor Point holds, and the
 * one the bulletin named that it does not.
 */
export interface BriefCitationRow {
  ref: string;
  title: string;
  /**
   * Absent for a ref the library does not carry AND for a carried document that
   * has never been released — two different facts that share one rendering,
   * which is why `carried` is a separate field rather than `!!currentRevision`.
   */
  currentRevision?: string;
  requiredAction: string;
  carried: boolean;
}

/**
 * Expand a filed Impact Brief into A2UI v0.9 operations:
 * createSurface + updateComponents (flat components, root id "root").
 *
 * `refsOnFile` is the LIVE register's refs — `store.refsOnFile()` on the server.
 * Passed in rather than read here so this module stays a pure function of its
 * inputs and the uncarried-row assertion can be tested against a register the
 * test controls.
 */
export function buildImpactBriefOps(
  brief: ImpactBrief,
  refsOnFile: readonly string[],
  surfaceId: string = IMPACT_BRIEF_SURFACE_ID,
): A2UIOp[] {
  const onFile = new Set(refsOnFile.map(canonicalRef));
  const components: Component[] = [];
  const rootChildren: string[] = [];

  components.push({
    id: "heading",
    component: "Heading",
    text: "Impact brief",
  });
  rootChildren.push("heading");

  components.push({
    id: "brief-meta",
    component: "BriefMeta",
    source: brief.source,
    space: brief.space,
    // Carried across VERBATIM, exactly as `POST /briefs` stored it: the
    // effective date is a claim the DOCUMENT makes, and a canvas that reformats
    // it is the app editing a regulator's statement on its way to a screen.
    effective: brief.effective,
    filedBy: brief.filedBy,
    role: brief.role,
    filedAt: brief.createdAt,
  });
  rootChildren.push("brief-meta");

  components.push({
    id: "brief-summary",
    component: "Text",
    text: brief.summary,
    tone: "muted",
  });
  rootChildren.push("brief-summary");

  const rows: BriefCitationRow[] = brief.citations.map((citation) => ({
    ref: citation.ref,
    title: citation.title,
    ...(citation.currentRevision
      ? { currentRevision: citation.currentRevision }
      : {}),
    requiredAction: citation.requiredAction,
    carried: onFile.has(canonicalRef(citation.ref)),
  }));

  components.push({
    id: "brief-citations",
    component: "BriefCitations",
    rows,
  });
  rootChildren.push("brief-citations");

  // `impacts` is capped at three by `POST /briefs`; an empty list is a brief the
  // desk has no follow-up for, and the section is dropped rather than rendered
  // as an empty heading.
  if (brief.impacts.length) {
    components.push({
      id: "brief-impacts",
      component: "BriefImpacts",
      items: brief.impacts,
    });
    rootChildren.push("brief-impacts");
  }

  components.unshift({
    id: "root",
    component: "Stack",
    gap: "lg",
    children: rootChildren,
  });

  return [
    {
      version: "v0.9",
      createSurface: { surfaceId, catalogId: REPORT_CATALOG_ID },
    },
    { version: "v0.9", updateComponents: { surfaceId, components } },
  ];
}
