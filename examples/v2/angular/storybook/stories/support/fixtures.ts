import type { AssistantMessage, Message } from "@ag-ui/client";
import type { Attachment, Suggestion } from "@copilotkit/angular";

/**
 * Deterministic, network-free media for attachment stories: images are inline
 * SVG and audio is a short generated silent WAV, both as base64 data sources.
 */

const toBase64 = (asciiText: string) => btoa(asciiText);

/** A small landscape-style illustration, tinted by `hue`. */
export function sampleImageBase64(hue = 220): string {
  return toBase64(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
  <rect width="320" height="240" fill="hsl(${hue} 70% 88%)"/>
  <circle cx="240" cy="70" r="28" fill="hsl(${hue + 30} 90% 70%)"/>
  <path d="M0 200 L90 110 L160 180 L220 130 L320 210 L320 240 L0 240 Z" fill="hsl(${hue} 45% 45%)"/>
</svg>`);
}

/** A short mono 8kHz silent WAV (3s by default). */
export function silentWavBase64(seconds = 3): string {
  const sampleRate = 8000;
  const samples = Math.round(sampleRate * seconds);
  const buffer = new ArrayBuffer(44 + samples);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string) =>
    [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeString(36, "data");
  view.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) view.setUint8(44 + i, 128);
  let binary = "";
  new Uint8Array(buffer).forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

export const sampleAttachments: Attachment[] = [
  {
    id: "image-1",
    type: "image",
    source: {
      type: "data",
      value: sampleImageBase64(210),
      mimeType: "image/svg+xml",
    },
    filename: "dashboard.svg",
    size: 18_432,
    status: "ready",
  },
  {
    id: "image-2",
    type: "image",
    source: {
      type: "data",
      value: sampleImageBase64(150),
      mimeType: "image/svg+xml",
    },
    filename: "wireframe.svg",
    size: 9_120,
    status: "ready",
  },
  {
    id: "doc-1",
    type: "document",
    source: { type: "url", value: "about:blank", mimeType: "application/pdf" },
    filename: "Q3-launch-plan.pdf",
    size: 482_133,
    status: "ready",
  },
  {
    id: "audio-1",
    type: "audio",
    source: { type: "data", value: silentWavBase64(), mimeType: "audio/wav" },
    filename: "voice-note.wav",
    size: 2_044,
    status: "ready",
  },
];

/**
 * An assistant turn that called three tools. With the tool messages in
 * {@link toolCallConversation}, two are done and the third is still running.
 */
export const toolCallTurn: AssistantMessage = {
  id: "assistant-tools",
  role: "assistant",
  content:
    "I'll search the docs, run the numbers, and check the weather for you.",
  toolCalls: [
    {
      id: "search-1",
      type: "function",
      function: {
        name: "search",
        arguments: JSON.stringify({
          query: "Angular signals guide",
          filters: ["official", "latest"],
        }),
      },
    },
    {
      id: "calc-1",
      type: "function",
      function: {
        name: "calculator",
        arguments: JSON.stringify({ expression: "42 * 17" }),
      },
    },
    {
      id: "weather-1",
      type: "function",
      function: {
        name: "getWeather",
        arguments: JSON.stringify({ location: "San Francisco", units: "F" }),
      },
    },
  ],
};

/** The same turn mid-stream: the last call's arguments are still arriving. */
export const streamingToolCallTurn: AssistantMessage = {
  ...toolCallTurn,
  toolCalls: toolCallTurn.toolCalls!.map((call) =>
    call.id === "weather-1"
      ? {
          ...call,
          function: {
            ...call.function,
            arguments: '{"location": "San Francisco", "units": "fahren',
          },
        }
      : call,
  ),
};

export const toolCallUserTurn: Message = {
  id: "user-tools",
  role: "user",
  content:
    "Find the Angular signals guide, work out 42 × 17, and check the weather in San Francisco.",
};

export const toolCallConversation: Message[] = [
  toolCallUserTurn,
  toolCallTurn,
  {
    id: "tool-search-1",
    role: "tool",
    toolCallId: "search-1",
    content:
      "Found 5 pages, including “Signals overview” and “Computed signals”.",
  },
  { id: "tool-calc-1", role: "tool", toolCallId: "calc-1", content: "714" },
];

// ---------------------------------------------------------------------------
// Shared with the React Storybook (examples/v2/react/storybook/stories/support/fixtures.ts)
// ---------------------------------------------------------------------------

/**
 * One user message answered in several steps (text, a tool call, more text).
 * The steps read as a single reply, so it gets one toolbar by default.
 */
export const multiStepReply: Message[] = [
  {
    id: "multi-user",
    role: "user",
    content: "How many open launch tasks does each team still have?",
  },
  {
    id: "multi-assistant-1",
    role: "assistant",
    content: "Let me pull the latest numbers from the tracker.",
  },
  {
    id: "multi-assistant-2",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "multi-tool",
        type: "function",
        function: {
          name: "getOpenTasks",
          arguments: JSON.stringify({ project: "Q3 launch" }),
        },
      },
    ],
  },
  {
    id: "multi-tool-result",
    role: "tool",
    toolCallId: "multi-tool",
    content: "engineering: 4, design: 0, marketing: 7, support: 3",
  },
  {
    id: "multi-assistant-3",
    role: "assistant",
    content:
      "Here's where things stand:\n\n- **Engineering:** 4 open\n- **Design:** done\n- **Marketing:** 7 open\n- **Support:** 3 open\n\nMarketing is the long pole; want me to draft a nudge?",
  },
];

/** A short finished conversation, for chats that open mid-thread. */
export const conversation: Message[] = [
  {
    id: "user-1",
    role: "user",
    content: "What does CopilotKit's Angular package give me?",
  },
  {
    id: "assistant-1",
    role: "assistant",
    content:
      "Drop-in chat components (`<copilot-chat>`, `<copilot-popup>`, `<copilot-sidebar>`), signals-based agent state, and hooks for frontend tools and human-in-the-loop.\n\n```ts\nimport { provideCopilotKit } from '@copilotkit/angular';\n\nbootstrapApplication(App, {\n  providers: [provideCopilotKit({ runtimeUrl: '/api/copilotkit' })],\n});\n```",
  },
];

export const storySuggestions: Suggestion[] = [
  {
    title: "Summarize conversation",
    message: "Summarize our latest messages",
    isLoading: false,
  },
  {
    title: "Draft reply",
    message: "Draft a detailed response",
    isLoading: false,
  },
  {
    title: "List next steps",
    message: "List action items from this chat",
    isLoading: false,
  },
];

/**
 * Welcome-screen starters: each title is the card header and each message the
 * card body (and what gets sent when picked).
 */
export const starterSuggestions: Suggestion[] = [
  {
    title: "Plan a launch",
    message: "Turn the Q3 goals into a week-by-week launch checklist",
    isLoading: false,
  },
  {
    title: "Summarize a thread",
    message: "Pull the decisions and owners out of a long discussion",
    isLoading: false,
  },
  {
    title: "Draft a reply",
    message: "Write a friendly follow-up to yesterday's design review",
    isLoading: false,
  },
  {
    title: "Explain a concept",
    message: "Walk me through how Angular signals manage component state",
    isLoading: false,
  },
];

/** More suggestions than fit in one row, to show the docked bar scrolling. */
export const manySuggestions: Suggestion[] = [
  "Summarize conversation",
  "Draft reply",
  "List next steps",
  "Translate to Spanish",
  "Make it shorter",
  "Add a code example",
  "Explain like I'm five",
  "Create a checklist",
].map((title) => ({ title, message: title, isLoading: false }));

/** Suggestions in the static `suggestionsConfig` shape `provideCopilotKit` takes. */
export const suggestionsConfig = (suggestions: Suggestion[]) => [
  {
    available: "always" as const,
    suggestions: suggestions.map(({ title, message }) => ({ title, message })),
  },
];

/** Thread records in the shape `<copilotkit-threads-drawer>` renders. */
const hoursAgo = (hours: number) =>
  new Date(Date.UTC(2026, 8, 25, 12) - hours * 3_600_000).toISOString();

export const storyThreads = [
  { name: "Q3 launch checklist", hours: 0.2 },
  { name: "Migrate polling to SSE", hours: 3 },
  { name: "Pricing page copy review", hours: 26 },
  { name: "Customer interview notes", hours: 50 },
  { name: "Onboarding email sequence", hours: 120 },
  { name: "Hiring plan for design", hours: 300 },
].map(({ name, hours }, index) => ({
  id: `thread-${index + 1}`,
  name,
  archived: false,
  createdAt: hoursAgo(hours + 1),
  updatedAt: hoursAgo(hours),
  lastRunAt: hoursAgo(hours),
}));

/** A reply that exercises every place the streaming cursor can ride. */
export const streamingCursorReply = `Here's how the cursor follows a reply as it's **written**, block by block.

## A heading

It trails the last word of each paragraph, including [links](https://docs.copilotkit.ai) and \`inline code\`.

- Lists put it after the newest item
- Nested items work too
  - even two levels deep

> Quotes keep it inside the quote.

\`\`\`ts
// Code streams without a cursor, then it picks up again after.
const agent = injectAgentStore("default");
\`\`\`

| Case | Cursor |
| --- | --- |
| Table cell | After the last cell |

And once the reply finishes, it disappears.`;
