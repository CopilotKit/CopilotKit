import { z } from "zod";
import { tool } from "@strands-agents/sdk";
import type { JSONValue } from "@strands-agents/sdk";
import { crm } from "../crm/store.js";
import { teamStats, repStats } from "../crm/analytics.js";

/**
 * analyze_team — whole-team aggregates for the manager view (READ-ONLY).
 *
 * Returns `teamStats` verbatim over the current CRM snapshot:
 *   { totalBookings, weightedForecast, winRate, leaderboard[], byCategory[] }
 * The leaderboard is sorted by bookings desc (ties broken by id) inside
 * `teamStats`. The optional `period` is accepted for forward-compat but the
 * headline aggregates are current-snapshot figures.
 */
export const analyzeTeamTool = tool({
  name: "analyze_team",
  description:
    'Summarize the whole sales team: total bookings, weighted forecast, win rate, a per-rep leaderboard (bookings, open pipeline, attainment, deal count) and open-pipeline revenue by product category. Read-only — use this for "how\'s the team tracking?" / manager questions. Renders as a TeamStatsCard.',
  inputSchema: z.object({
    period: z
      .string()
      .optional()
      .describe(
        'Optional period label (e.g. "this-quarter"). Headline aggregates are current-snapshot figures.',
      ),
  }),
  callback: () => {
    const state = crm.getStateSnapshot();
    return teamStats(state) as unknown as JSONValue;
  },
});

/**
 * rep_performance — drill into one salesperson (READ-ONLY).
 *
 * Resolves the rep by id (preferred) or fuzzy name (`findSalespersonByName`),
 * then returns `repStats` verbatim:
 *   { rep, bookings, openPipeline, attainment, winRate, dealCount, trend[8], deals[] }
 * Throws when neither input resolves a known rep.
 */
export const repPerformanceTool = tool({
  name: "rep_performance",
  description:
    'Show one salesperson\'s numbers: attainment, bookings, open pipeline, win rate, deal count, an 8-point monthly bookings trend, and the deals they own. Resolve the rep by repId or by name (e.g. "Maya"). Read-only — renders as a RepStatsCard. Use for "show me <rep>\'s numbers".',
  inputSchema: z.object({
    repId: z
      .string()
      .optional()
      .describe("Salesperson id (e.g. s2). Preferred when known."),
    name: z
      .string()
      .optional()
      .describe('Salesperson name to fuzzy-match (e.g. "Maya").'),
  }),
  callback: ({ repId, name }) => {
    const resolvedId = repId
      ? repId
      : name
        ? crm.findSalespersonByName(name)?.id
        : undefined;
    if (!resolvedId) {
      throw new Error(
        `salesperson not found: ${repId ?? name ?? "(no name or repId provided)"}`,
      );
    }
    const state = crm.getStateSnapshot();
    // repStats throws on an unknown id, covering a stale repId too.
    return repStats(state, resolvedId) as unknown as JSONValue;
  },
});
