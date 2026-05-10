/**
 * D5 — beautiful-chat / Schedule Meeting.
 *
 * Single-turn probe asserting the HITL `scheduleTime` MeetingTimePicker
 * mounts. Assertion CLICKS a slot to resolve the HITL pause and
 * verifies the confirmed-state heading appears. Part of the
 * `beautiful-chat-*` family — see `_beautiful-chat-shared.ts` for
 * context (including the `BeautifulChatPage` shape this probe
 * needs for `.click()`).
 */

import {
  registerD5Script,
  type D5BuildContext,
} from "../helpers/d5-registry.js";
import type { ConversationTurn } from "../helpers/conversation-runner.js";
import {
  assertScheduleMeeting,
  preNavigateBeautifulChat,
} from "./_beautiful-chat-shared.js";

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input:
        "d5 beautiful-chat probe: schedule a 30-minute meeting to learn about CopilotKit",
      assertions: assertScheduleMeeting,
    },
  ];
}

registerD5Script({
  featureTypes: ["beautiful-chat-schedule-meeting"],
  fixtureFile: "beautiful-chat-schedule-meeting.json",
  buildTurns,
  preNavigateRoute: preNavigateBeautifulChat,
});
