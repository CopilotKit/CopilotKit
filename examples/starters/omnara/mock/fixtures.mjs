// Synthetic AG-UI runs for local UI checks; no vendor or Intelligence calls.
// Each export builds a run with fresh IDs.
let n = 0;
const id = (p) => `${p}_${(++n).toString(36)}`;

/** Text streamed a few words at a time, like the adapter's live text previews. */
function text(s) {
  const messageId = id("msg");
  const words = s.split(/(?<=\s)/);
  const chunks = [];
  for (let i = 0; i < words.length; i += 3)
    chunks.push(words.slice(i, i + 3).join(""));
  return [
    { type: "TEXT_MESSAGE_START", messageId, role: "assistant" },
    ...chunks.map((delta) => ({
      type: "TEXT_MESSAGE_CONTENT",
      messageId,
      delta,
    })),
    { type: "TEXT_MESSAGE_END", messageId },
  ];
}

export const fallback = () =>
  text("Hello! This is a local mock response from the starter.");
export const followup = () =>
  text("This is the second response in the same conversation.");

/** A finished web search, as the adapter streams Omnara's built-in tools. */
export const search = (toolCallId = id("call")) => [
  { type: "TOOL_CALL_START", toolCallId, toolCallName: "web_search" },
  {
    type: "TOOL_CALL_ARGS",
    toolCallId,
    delta: JSON.stringify({ query: "Omnara" }),
  },
  { type: "TOOL_CALL_END", toolCallId },
  {
    type: "TOOL_CALL_RESULT",
    messageId: id("msg"),
    toolCallId,
    role: "tool",
    content: "Omnara is an open-source managed agent platform.",
  },
  ...text("Omnara is an open-source managed agent platform."),
];

/**
 * A complete run that ends with an Omnara interrupt, as the adapter raises it.
 * Interrupts end the run, so the list carries its own RUN_FINISHED.
 */
const interrupted = (interrupt, runId = id("run")) => [
  { type: "RUN_STARTED", threadId: "mock", runId },
  {
    type: "RUN_FINISHED",
    threadId: "mock",
    runId,
    outcome: { type: "interrupt", interrupts: [interrupt] },
  },
];

/** An approval for a gated tool. */
export const approval = () =>
  interrupted({
    id: "int_mock",
    reason: "omnara:permission",
    message: "Permission requested for run_command",
    toolCallId: "call_command",
    metadata: {
      omnara: {
        kind: "permission",
        toolName: "run_command",
        form: {
          title: "Permission requested for run_command",
          context: [{ label: "Command", value: "npm test" }],
          questions: [
            {
              prompt: "Allow this command?",
              options: [
                { label: "Allow" },
                { label: "Deny", allows_text: true },
              ],
            },
          ],
        },
      },
    },
  });
export const approved = () => text("Approved. The command ran.");
export const denied = () => text("Denied. I won't run the command.");

/** A question from `ask_question`, with Omnara's "Other" option. */
export const question = () =>
  interrupted({
    id: "int_question",
    reason: "omnara:question",
    message: "Question",
    toolCallId: "call_question",
    metadata: {
      omnara: {
        kind: "question",
        toolName: "ask_question",
        form: {
          title: "Question",
          questions: [
            {
              prompt: "Which weekend project sounds best?",
              options: [
                { label: "Hiking" },
                { label: "Baking" },
                { label: "Other", allows_text: true },
              ],
            },
          ],
        },
      },
    },
  });
export const answered = () => text("Thanks. Let's plan a pottery weekend.");
