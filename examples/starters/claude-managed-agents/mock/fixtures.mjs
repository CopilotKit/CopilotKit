// Synthetic text streams for local UI checks; no vendor or Intelligence calls.
let n = 0;
const id = (p) => `${p}_${(++n).toString(36)}`;

/** Text streamed a few words at a time, like the adapter's event_delta previews. */
export function text(s) {
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

export const fallback = text(
  "Hello! This is a local mock response from the starter.",
);
export const followup = text(
  "This is the second response in the same conversation.",
);
