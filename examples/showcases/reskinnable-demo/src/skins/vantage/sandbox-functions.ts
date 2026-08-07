import { z } from "zod";
import type { SandboxFunction } from "@copilotkit/react-core/v2";

/**
 * Exposed inside OGUI sandboxed iframes so generated views can read real
 * figures rather than inventing them. Read-only by design: the ungoverned
 * register may VISUALISE anything, but it must not mutate the app.
 */
export const sandboxFunctions: SandboxFunction[] = [
  {
    name: "getSeries",
    description:
      "Fetch a metric series under a lens. Returns { series, breakdown, " +
      "waterfall }. Params: metric, period, compare, segment, region, grain, " +
      "currency, dimension — all optional except metric.",
    parameters: z.object({
      metric: z.string().optional(),
      period: z.string().optional(),
      compare: z.string().optional(),
      segment: z.string().optional(),
      region: z.string().optional(),
      grain: z.string().optional(),
      currency: z.string().optional(),
      dimension: z.string().optional(),
    }),
    handler: async (args: Record<string, string> = {}) => {
      const params = new URLSearchParams(
        Object.entries(args).filter(([, v]) => v != null) as [string, string][],
      );
      const res = await fetch(`/api/vantage/v1/series?${params.toString()}`);
      return res.ok ? await res.json() : { error: `HTTP ${res.status}` };
    },
  },
  {
    name: "getKpis",
    description:
      "Fetch the headline KPI tiles under a lens. Accepts the same lens params.",
    parameters: z.object({
      metric: z.string().optional(),
      period: z.string().optional(),
      compare: z.string().optional(),
      segment: z.string().optional(),
      region: z.string().optional(),
      grain: z.string().optional(),
      currency: z.string().optional(),
      dimension: z.string().optional(),
    }),
    handler: async (args: Record<string, string> = {}) => {
      const params = new URLSearchParams(
        Object.entries(args).filter(([, v]) => v != null) as [string, string][],
      );
      const res = await fetch(`/api/vantage/v1/kpis?${params.toString()}`);
      return res.ok ? await res.json() : { error: `HTTP ${res.status}` };
    },
  },
  {
    name: "getDeals",
    description:
      "Fetch deals. Params: status (slipped|won|open), region, minValue.",
    parameters: z.object({
      status: z.string().optional(),
      region: z.string().optional(),
      minValue: z.string().optional(),
    }),
    handler: async (args: Record<string, string> = {}) => {
      const params = new URLSearchParams(
        Object.entries(args).filter(([, v]) => v != null) as [string, string][],
      );
      const res = await fetch(`/api/vantage/v1/deals?${params.toString()}`);
      return res.ok ? await res.json() : { error: `HTTP ${res.status}` };
    },
  },
];
