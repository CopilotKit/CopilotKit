import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { CopilotChatView } from "@copilotkit/react-core/v2";
import { withFullHeight } from "./support/layouts";
import {
  manySuggestions,
  reactHooksConversation,
  starterSuggestions,
  storySuggestions,
} from "./support/fixtures";
import type { Suggestion } from "@copilotkit/core";

const meta = {
  title: "UI/CopilotChatView",
  decorators: [withFullHeight],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "A complete chat interface with message feed and input components.",
      },
    },
  },
} satisfies Meta<{}>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => {
    return (
      <div style={{ height: "100%" }}>
        <CopilotChatView
          messages={reactHooksConversation}
          onSubmitMessage={fn()}
          messageView={{
            assistantMessage: {
              onThumbsUp: fn(),
              onThumbsDown: fn(),
            },
          }}
        />
      </div>
    );
  },
};

export const PinToSend: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "Pin-to-send mode anchors the user's last message at the top of the viewport when they submit. Useful for inspecting how content fades (or doesn't) above the input.",
      },
    },
  },
  render: () => {
    return (
      <div style={{ height: "100%" }}>
        <CopilotChatView
          autoScroll="pin-to-send"
          messages={pinToSendMessages}
          onSubmitMessage={fn()}
        />
      </div>
    );
  },
};

export const WithSuggestions: Story = {
  render: () => (
    <div style={{ height: "100%" }}>
      <CopilotChatView
        messages={reactHooksConversation}
        suggestions={suggestionSamples}
        onSelectSuggestion={fn()}
        onSubmitMessage={fn()}
        messageView={{
          assistantMessage: {
            onThumbsUp: fn(),
            onThumbsDown: fn(),
          },
        }}
      />
    </div>
  ),
};

/**
 * No messages yet: the greeting, suggestion cards (title as header, message as
 * body) and the input below them.
 */
export const WelcomeScreen: Story = {
  render: () => (
    <CopilotChatView
      messages={[]}
      suggestions={starterSuggestions}
      onSelectSuggestion={fn()}
      onSubmitMessage={fn()}
    />
  ),
};

/** A run in flight: typing cursor in the transcript, stop button in the input. */
export const Running: Story = {
  render: () => (
    <CopilotChatView
      messages={[
        ...reactHooksConversation,
        {
          id: "user-3",
          role: "user" as const,
          content: "And how would I persist that count across reloads?",
        },
      ]}
      isRunning
      onStop={fn()}
      onSubmitMessage={fn()}
    />
  ),
};

// The last suggestion is still loading, to show the pill's loading state.
const suggestionSamples: Suggestion[] = storySuggestions.map(
  (suggestion, index) =>
    index === 2 ? { ...suggestion, isLoading: true } : suggestion,
);

// Enough back-and-forth to force scrolling so the feather region above the
// input is clearly visible in pin-to-send mode.
const pinToSendMessages = [
  {
    id: "u1",
    role: "user" as const,
    content: "Give me a quick intro to useEffect.",
    timestamp: new Date(),
  },
  {
    id: "a1",
    role: "assistant" as const,
    content: `\`useEffect\` runs side effects after render. Common uses:

- Data fetching
- Subscriptions
- Manual DOM work
- Timers

It takes a callback and an optional dependency array. If the deps change between renders, the callback re-runs. Return a cleanup function to tear down subscriptions or timers.`,
    timestamp: new Date(),
  },
  {
    id: "u2",
    role: "user" as const,
    content: "Show me a subscription example.",
    timestamp: new Date(),
  },
  {
    id: "a2",
    role: "assistant" as const,
    content: `\`\`\`jsx
useEffect(() => {
  const socket = new WebSocket(url);
  socket.addEventListener("message", onMessage);
  return () => socket.close();
}, [url]);
\`\`\`

The cleanup closes the socket if \`url\` changes or the component unmounts. Without it you'd leak connections on every dependency change.`,
    timestamp: new Date(),
  },
  {
    id: "u3",
    role: "user" as const,
    content: "What about running something only once on mount?",
    timestamp: new Date(),
  },
  {
    id: "a3",
    role: "assistant" as const,
    content: `Pass an empty dependency array:

\`\`\`jsx
useEffect(() => {
  analytics.track("page_viewed");
}, []);
\`\`\`

With \`[]\`, React runs the effect once after the first render and never again (in production — Strict Mode runs it twice in dev to help surface cleanup bugs).`,
    timestamp: new Date(),
  },
  {
    id: "u4",
    role: "user" as const,
    content:
      "How do I avoid the stale-closure trap when reading state inside an effect?",
    timestamp: new Date(),
  },
  {
    id: "a4",
    role: "assistant" as const,
    content: `A few options:

1. **Add the value to deps** so the effect re-subscribes with the fresh closure.
2. **Use a ref** (\`useRef\`) and read \`ref.current\` inside the callback — the ref always sees the latest value.
3. **Use functional setState** when updating: \`setCount(c => c + 1)\` avoids reading the stale \`count\`.

Dependency arrays are the honest answer — refs are an escape hatch when the value changes too often to re-subscribe on.`,
    timestamp: new Date(),
  },
  {
    id: "u5",
    role: "user" as const,
    content: "Anything to watch out for with async work inside useEffect?",
    timestamp: new Date(),
  },
  {
    id: "a5",
    role: "assistant" as const,
    content: `Two big ones:

1. **The effect itself can't be \`async\`.** Define an inner async function and call it: \`useEffect(() => { (async () => { ... })(); }, [])\`.
2. **Guard against unmount / stale responses.** If a fetch resolves after the component unmounts (or after a new request starts), you'll either set state on an unmounted component or overwrite newer data with older. An \`ignore\` flag in cleanup, or an \`AbortController\`, handles both.`,
    timestamp: new Date(),
  },
];

/**
 * More suggestions than fit: the docked bar above the input scrolls
 * horizontally, and its right edge fades to show there is more.
 */
export const WithManySuggestions: Story = {
  render: () => (
    <CopilotChatView
      messages={reactHooksConversation}
      suggestions={manySuggestions}
      onSelectSuggestion={fn()}
      onSubmitMessage={fn()}
    />
  ),
};

/** The welcome screen with `introAnimation={false}`: content appears immediately. */
export const WithoutIntroAnimation: Story = {
  render: () => (
    <CopilotChatView
      messages={[]}
      suggestions={starterSuggestions}
      introAnimation={false}
      onSelectSuggestion={fn()}
      onSubmitMessage={fn()}
    />
  ),
};
