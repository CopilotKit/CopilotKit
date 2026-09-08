import type { NextRequest } from "next/server";
import * as store from "@/skins/people/data/store";
import { errorResponse } from "@/skins/people/data/http";

/**
 * BEAT 5, step 1 — build the new-hire checklist.
 *
 * The default list lives here rather than in the agent's prompt so the stored
 * procedure the agent recalls can stay short ("create the onboarding tasks")
 * instead of enumerating seven task labels it would then paraphrase differently
 * every run. A demo that renders a slightly different checklist each time reads
 * as improvisation.
 */
const DEFAULT_CHECKLIST = [
  {
    label: "Laptop, badge, and building access",
    owner: "IT",
    dueOffsetDays: -2,
  },
  {
    label: "Payroll, benefits, and equity paperwork",
    owner: "People Ops",
    dueOffsetDays: 1,
  },
  {
    label: "Repo access and development environment",
    owner: "Engineering",
    dueOffsetDays: 2,
  },
  {
    label: "Safety certification for the robot cell",
    owner: "Facilities",
    dueOffsetDays: 5,
  },
  { label: "First-week pairing sessions", owner: "Buddy", dueOffsetDays: 5 },
  {
    label: "30-day check-in with the manager",
    owner: "Manager",
    dueOffsetDays: 30,
  },
];

export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const supplied = Array.isArray(body?.tasks) ? body.tasks : null;
    const tasks = supplied?.length
      ? supplied.map(
          (t: {
            label?: unknown;
            owner?: unknown;
            dueOffsetDays?: unknown;
          }) => ({
            label: String(t?.label ?? "Task"),
            owner: String(t?.owner ?? "People Ops"),
            dueOffsetDays: Number(t?.dueOffsetDays ?? 0),
          }),
        )
      : DEFAULT_CHECKLIST;
    const created = store.createOnboardingTasks(id, tasks);
    return Response.json(created, { status: 201 });
  } catch (error) {
    return errorResponse(error, "POST employees/[id]/onboarding-tasks");
  }
};
