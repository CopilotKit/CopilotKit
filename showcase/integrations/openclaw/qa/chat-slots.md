# QA: Chat Slots (OpenClaw)

Demo source: `src/app/demos/chat-slots/page.tsx`
Route: `/demos/chat-slots` · Agent: `chat-slots`

## What it exercises

A pure-frontend "Slot Atlas": every overrideable slot on `CopilotChat` is wrapped
in a dashed, color-coded `SlotMarker` (see `slot-wrappers.tsx` + `slot-marker.tsx`)
so a developer can see at a glance what is customizable and where it lives.
Slots covered: `welcomeScreen` (+ nested `welcomeMessage`), `messageView`
(`assistantMessage`, `userMessage`, `reasoningMessage`, `cursor`), `input`
(`textArea`, `sendButton`, `disclaimer`, `addMenuButton`), `suggestionView`
(`container`, `suggestion`), and `scrollView` (`scrollToBottomButton`, `feather`).

This is a rendering/customization demo — the slot wiring is entirely
client-side. OpenClaw's role is just to be the chat backend: the `chat-slots`
route proxies to the same single stateless gateway endpoint
(`POST /v1/ag-ui/operator`) as every other demo, and streams a normal token
response. No demo-specific tools or backend behaviour are involved.

## Manual steps

1. Open the demo. Confirm the custom **welcome screen** renders inside a dashed
   indigo marker (`data-testid="custom-welcome-screen"`), with the violet
   `WelcomeScreen.WelcomeMessage` marker and the two suggestion pills
   ("Write a sonnet", "Tell me a joke") beneath it.
2. Hover any marked region: its slot-path badge appears (e.g. `Input.TextArea`,
   `Input.SendButton`). Nested markers isolate correctly — hovering a child does
   not light up the parent's badge. Click a badge to copy its path.
3. Confirm the input row shows the wrapped `Input.TextArea`, `Input.SendButton`,
   `Input.AddMenuButton` (the "+" tools menu, seeded by `toolsMenu`), and the
   yellow `Input.Disclaimer` marker (`data-testid="custom-disclaimer"`).
4. Send **"Tell me a short joke."** (or click the suggestion). Confirm:
   - the user turn renders in the sky `MessageView.UserMessage` marker,
   - the assistant reply streams into the emerald `MessageView.AssistantMessage`
     marker (`data-testid="custom-assistant-message"`), with the amber
     `MessageView.Cursor` marker visible while streaming.
5. Scroll the transcript up mid/after a long reply: the fuchsia `ScrollView.Feather`
   gradient (`data-testid="custom-feather"`) sits above the input, and the lime
   `ScrollView.ScrollToBottomButton` marker appears bottom-right.

## Assertion bar

- Every listed slot renders inside its dashed color-coded marker; none of the
  default (unwrapped) chat UI leaks through.
- Hover isolation works: a hovered child marker does not also reveal ancestor
  badges (`:not(:has(.slot-marker:hover))`).
- The agent responds with normal streamed tokens into the assistant-message slot.
- No console errors or broken layout.

## Known caveats

- The **`MessageView.ReasoningMessage`** slot (rose marker) stays **dormant** on
  this demo. Its wrapper is registered for atlas completeness, but the
  `chat-slots` agent emits no `REASONING_MESSAGE_*` events, so the slot never
  mounts. This is expected — reasoning rendering is exercised at
  `/demos/reasoning-default` and `/demos/reasoning-custom` instead (ag-ui
  emits `REASONING_*` only in reasoning stream mode).
- The `Input.AddMenuButton` tools-menu action is an intentional no-op (seeded
  only so the slot has a reason to render).
- Slot-path copy needs a secure context (`navigator.clipboard`); the badge
  no-ops silently if clipboard is unavailable.
