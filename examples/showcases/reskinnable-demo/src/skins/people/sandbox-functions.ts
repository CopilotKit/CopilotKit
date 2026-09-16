import { z } from "zod";
import type { SandboxFunction } from "@copilotkit/react-core/v2";
import type { PeopleStoreState } from "./data/types";
import {
  ageInDays,
  bandPosition,
  isOutOfBand,
  REQUEST_KIND_LABEL,
  requestValueLabel,
} from "./data/derive";

/**
 * Functions exposed INSIDE the OGUI sandboxed iframe, so generated UI can bind
 * to Rowan's real ledger instead of the model typing numbers into markup.
 *
 * Two things this file is careful about:
 *
 *  1. It projects onto explicit DTOs rather than passing records through. The
 *     sandbox is a different trust boundary, and a spread of the raw employee
 *     object would carry email addresses and manager chains across it for no
 *     reason. Only what a generated view could legitimately draw goes over.
 *
 *  2. It reads a module-scope snapshot rather than a hook, because these are
 *     plain functions invoked from an iframe with no React context. The
 *     snapshot is kept current by `<SandboxDataSync />`, mounted in the skin's
 *     Providers — without that component these return an empty ledger, which
 *     renders as a plausible-looking but entirely blank generated UI.
 */

let snapshot: PeopleStoreState | null = null;

export function setSandboxSnapshot(next: PeopleStoreState) {
  snapshot = next;
}

const empty: PeopleStoreState = {
  employees: [],
  bands: [],
  requests: [],
  compRequests: [],
  bandExceptions: [],
  onboardingTasks: [],
  packets: [],
  operators: [],
};

const read = () => snapshot ?? empty;

export const sandboxFunctions: SandboxFunction[] = [
  {
    name: "getPeople",
    description:
      "Everyone on the roster with their level, team, tenure, salary and " +
      "position in their compensation band.",
    parameters: z.object({
      team: z.string().optional().describe("Restrict to one team."),
      level: z
        .string()
        .optional()
        .describe('Restrict to one level, e.g. "L5".'),
    }),
    handler: async ({ team, level }: { team?: string; level?: string }) => {
      const { employees, bands } = read();
      return employees
        .filter(
          (e) => (!team || e.team === team) && (!level || e.level === level),
        )
        .map((e) => {
          const pos = bandPosition(bands, e.baseSalary, e.level);
          return {
            id: e.id,
            name: e.name,
            title: e.title,
            level: e.level,
            team: e.team,
            status: e.status,
            baseSalary: e.baseSalary,
            bandRatio: pos?.ratio ?? null,
            outOfBand: pos?.outOfBand ?? false,
            side: pos?.side ?? null,
          };
        });
    },
  },
  {
    name: "getBands",
    description: "The compensation band table: level, label, min, mid and max.",
    parameters: z.object({}),
    handler: async () => read().bands,
  },
  {
    name: "getRequests",
    description:
      "The request queue — time off, equipment, training, role changes — with " +
      "how many days each has been waiting.",
    parameters: z.object({
      status: z
        .enum(["all", "pending", "approved", "declined"])
        .optional()
        .describe("Defaults to pending."),
    }),
    handler: async ({ status = "pending" }: { status?: string }) => {
      const { requests, employees } = read();
      return requests
        .filter((r) => status === "all" || r.status === status)
        .map((r) => ({
          id: r.id,
          employee:
            employees.find((e) => e.id === r.employeeId)?.name ?? "Unknown",
          kind: REQUEST_KIND_LABEL[r.kind],
          summary: r.summary,
          status: r.status,
          ageDays: ageInDays(r.submittedAt),
          value: requestValueLabel(r),
        }));
    },
  },
  {
    name: "getPeopleKpis",
    description:
      "Headline People Ops figures: headcount, how many sit outside their " +
      "band, open requests, pending compensation requests, and people onboarding.",
    parameters: z.object({}),
    handler: async () => {
      const { employees, bands, requests, compRequests } = read();
      return {
        headcount: employees.length,
        outOfBand: employees.filter((e) => isOutOfBand(bands, e)).length,
        openRequests: requests.filter((r) => r.status === "pending").length,
        pendingCompRequests: compRequests.filter((c) => c.status === "pending")
          .length,
        onboarding: employees.filter((e) => e.status === "onboarding").length,
        teams: [...new Set(employees.map((e) => e.team))],
      };
    },
  },
];
