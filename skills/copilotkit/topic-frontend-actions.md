# Frontend Actions

Client-side action/tool patterns and UI-side execution guidance.

## Guidance
### Frontend Actions
- Route: `/frontend-actions`
- Source: `docs/content/docs/(root)/frontend-actions.mdx`
- Description: Create frontend actions and use them within your agent.

This video shows the result of `npx copilotkit@latest init` with the [implementation](#implementation) section applied to it!

## What is this?

Frontend actions are powerful tools that allow your AI agents to directly interact with and update your application's user interface. Think of them as bridges that connect your agent's decision-making capabilities with your frontend's interactive elements.

## When should I use this?

Frontend actions are essential when you want to create truly interactive AI applications where your agent needs to:

- Dynamically update UI elements
- Trigger frontend animations or transitions
- Show alerts or notifications
- Modify application state
- Handle user interactions programmatically

Without frontend actions, agents are limited to just processing and returning data. By implementing frontend actions, you can create rich, interactive experiences where your agent actively drives the user interface.

## Choose your Integration

Frontend actions can be implemented with any agentic backend, with each integration providing different approaches for connecting agents to your UI.

**Choose your integration to see specific implementation guides and examples.**

### Copilot Suggestions
- Route: `/copilot-suggestions`
- Source: `docs/content/docs/(root)/copilot-suggestions.mdx`
- Description: Learn how to auto-generate suggestions in the chat window based on real time application state.

useCopilotChatSuggestions is experimental. The interface is not final and can
  change without notice.

[`useCopilotChatSuggestions`](/reference/v1/hooks/useCopilotChatSuggestions) is a React hook that generates suggestions in the chat window based on real time application state.

### Simple Usage

```tsx
import { useCopilotChatSuggestions } from "@copilotkit/react-ui"; // [!code highlight]

export function MyComponent() {
  // [!code highlight:8]
  useCopilotChatSuggestions(
    {
      instructions: "Suggest the most relevant next actions.",
      minSuggestions: 1,
      maxSuggestions: 2,
    },
    [relevantState],
  );
}
```

### Dependency Management

```tsx
import { useCopilotChatSuggestions } from "@copilotkit/react-ui";

export function MyComponent() {
  useCopilotChatSuggestions(
    {
      instructions: "Suggest the most relevant next actions.",
      minSuggestions: 1,
      maxSuggestions: 2,
    },
    [relevantState], // [!code highlight]
  );
}
```

In the example above, the suggestions are generated based on the given instructions.
The hook monitors `relevantState`, and updates suggestions accordingly whenever it changes.

  ### Specify `"use client"` (Next.js App Router)

  This is only necessary if you are using Next.js with the App Router.

```tsx title="YourComponent.tsx"
"use client"
```

Like other React hooks such as `useState` and `useEffect`, this is a **client-side** hook.
If you're using Next.js with the App Router, you'll need to add the `"use client"` directive at the top of any file using this hook.

## Next Steps

- Check out [how to customize the suggestions look](/guides/custom-look-and-feel/bring-your-own-components#suggestions).
- Check out the [useCopilotChatSuggestions reference](/reference/v1/hooks/useCopilotChatSuggestions) for more details.
