/**
 * Dedicated Strands agent for the two interrupt demos.
 *
 * Mirrors the Python sibling's `agents/interrupt_agent.py`.
 *
 * `schedule_meeting` pauses itself through Strands' native interrupt system:
 * `context.interrupt(...)` halts the agent loop and the AG-UI bridge finishes
 * the run with `RUN_FINISHED` carrying `outcome.type === "interrupt"`. The
 * frontend renders the time picker from the interrupt payload, and resuming on
 * the same `threadId` returns the user's choice to that same `interrupt()`
 * call, so the tool body continues where it left off.
 *
 * The resume payload arrives wrapped: a resolved answer as `{ response: ... }`,
 * a client-side cancel as `{ cancelled: true }`. The bridge wraps it so one
 * tool body reads the same on both bridges, and because an answer the SDK reads
 * as absent would re-raise the same interrupt forever.
 *
 * This is a dedicated agent rather than a tool on the shared showcase agent
 * because `hitl-in-chat` registers a FRONTEND tool of the same name; one
 * backend `schedule_meeting` cannot be both client-executed and pausing.
 *
 * Pause and resume happen in the same process here, so no `SessionManager` is
 * needed. Durable resume across a restart requires one.
 *
 * Docs: https://strandsagents.com/docs/user-guide/concepts/interrupts/
 */

import { Agent, tool } from "@strands-agents/sdk";
import { z } from "zod";
import { StrandsAgent } from "@ag-ui/aws-strands";
import { createModel } from "./model-factory";

/** What the picker sends back. */
interface MeetingChoice {
  chosen_time?: string;
  chosen_label?: string;
  cancelled?: boolean;
}

/** The envelope the bridge hands a resumed tool. */
interface ResumeEnvelope {
  /** `null` when the client answered with no payload at all. */
  response?: MeetingChoice | null;
  cancelled?: boolean;
}

// @region[backend-interrupt-tool]
const scheduleMeeting = tool({
  name: "schedule_meeting",
  description:
    "Ask the user to pick a meeting time, then confirm what was scheduled.",
  inputSchema: z.object({
    topic: z.string().describe("Short description of the meeting purpose."),
    attendee: z.string().optional().describe("Who the meeting is with."),
  }),
  callback: ({ topic, attendee }, context) => {
    // Typed optional by the SDK, so this is checked rather than asserted: with
    // no context there is nothing to pause on, and pretending otherwise would
    // schedule a meeting the user never saw.
    if (!context) {
      throw new Error("schedule_meeting needs a tool context to pause on");
    }

    // `attendee` is optional and the reason has to be JSON, which has no
    // `undefined`, so it is omitted rather than sent as undefined.
    const answer = context.interrupt<ResumeEnvelope>({
      name: "schedule_meeting",
      reason: attendee === undefined ? { topic } : { topic, attendee },
    });

    // Two cancel shapes reach here: the bridge's sentinel for a cancelled
    // resume entry, and the picker's own Cancel button, which resolves with a
    // `cancelled` flag inside the payload. The value inside the envelope is
    // whatever the client sent, so it is checked rather than assumed.
    const inner = answer?.response;
    const payload: MeetingChoice =
      inner && typeof inner === "object" ? inner : {};
    if (answer?.cancelled || payload.cancelled) {
      return `User cancelled. Meeting NOT scheduled: ${topic}`;
    }

    const label = payload.chosen_label ?? payload.chosen_time;
    return label
      ? `Meeting scheduled for ${label}: ${topic}`
      : `User did not pick a time. Meeting NOT scheduled: ${topic}`;
  },
});
// @endregion[backend-interrupt-tool]

const SYSTEM_PROMPT = `You are a scheduling assistant.

Whenever the user asks you to book a call or schedule a meeting, you MUST call
the \`schedule_meeting\` tool. Pass a short \`topic\` describing the purpose and,
if known, an \`attendee\` describing who the meeting is with.

The tool pauses execution and shows the user a time picker. Once it resumes with
their choice, briefly confirm whether the meeting was scheduled and at what
time, or note that the user cancelled. Do not ask for approval yourself: always
call the tool and let the picker handle the decision. Keep responses short and
friendly.

Never claim a meeting is scheduled unless the tool result says so.`;

/** Build the agent backing gen-ui-interrupt and interrupt-headless. */
export async function buildInterruptAgent(): Promise<StrandsAgent> {
  return new StrandsAgent({
    agent: new Agent({
      model: await createModel(),
      systemPrompt: SYSTEM_PROMPT,
      tools: [scheduleMeeting],
    }),
    name: "interrupt",
    description:
      "Strands agent whose scheduling tool pauses natively for the user to pick a time",
  });
}
