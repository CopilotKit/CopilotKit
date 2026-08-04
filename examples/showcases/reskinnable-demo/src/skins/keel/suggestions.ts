import type { Suggestion } from "@/shell/skin-contract";

/**
 * The four Keel demo suggestion pills (registered by the shell,
 * available:"always"). Ordered to walk the demo arc (spec §11):
 *   1. ask what the policy says            -> search_knowledge + showSources
 *   2. turn that answer into a process     -> showPlaybook + startRun (HITL)
 *   3. see the approvals awaiting the role -> showApprovals
 *   4. put a bottleneck view on the canvas -> render_ops_report / OGUI
 *
 * Keel has no onSuggestionSelect, so none of these messages are string-matched;
 * each pill simply sends its message. Titles/messages are fixed by spec §10 and
 * are copied verbatim — a reword breaks the scripted demo walk.
 */
export const keelSuggestions: Suggestion[] = [
  {
    title: "Contractor PHI access",
    message:
      "What's our policy on giving a contractor access to patient records?",
  },
  {
    title: "Start an access request",
    message:
      "Start a PHI access request for Priya Raman, a Radiology contractor starting Monday.",
  },
  {
    title: "What needs me?",
    message: "What's waiting on my approval?",
  },
  {
    title: "Where are we stuck?",
    message: "Where are requests getting stuck? Build me a view on the canvas.",
  },
];
