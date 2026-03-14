# Frontend Tools

Client-side tool patterns and UI-side execution guidance.

## Guidance
### Frontend Tools
- Route: `/frontend-tools`
- Source: `docs/content/docs/(root)/frontend-tools.mdx`
- Description: Let your agent interact with and update your application's UI.

## What is this?

Frontend tools let your AI agents directly interact with and update your application's UI. They bridge the gap between your agent's decision-making and your frontend's interactive elements.

```tsx
  import { z } from "zod";
  import { useFrontendTool } from "@copilotkit/react-core/v2";

  useFrontendTool({
    name: "setTheme",
    description: "Switch the app's color theme",
    parameters: z.object({
      theme: z.enum(["light", "dark"]),
    }),
    handler: async ({ theme }) => {
      document.documentElement.dataset.theme = theme;
      return `Theme set to ${theme}!`;
    },
  });
```

## When should I use this?

Use frontend tools when your agent needs to:
- Dynamically update UI elements
- Trigger frontend animations or transitions
- Show alerts or notifications
- Modify application state

## Get started by choosing your AI backend

### Frontend Actions
- Route: `/frontend-actions`
- Source: `docs/content/docs/(root)/frontend-actions.mdx`
- Description: Create frontend actions and use them within your agent.

## What is this?

Frontend actions let your AI agents directly interact with and update your application's UI. They bridge the gap between your agent's decision-making and your frontend's interactive elements.

```tsx
  import { z } from "zod";
  import { useFrontendTool } from "@copilotkit/react-core/v2";

  useFrontendTool({
    name: "setTheme",
    description: "Switch the app's color theme",
    parameters: z.object({
      theme: z.enum(["light", "dark"]),
    }),
    handler: async ({ theme }) => {
      document.documentElement.dataset.theme = theme;
      return `Theme set to ${theme}!`;
    },
  });
```

## When should I use this?

Use frontend actions when your agent needs to:
- Dynamically update UI elements
- Trigger frontend animations or transitions
- Show alerts or notifications
- Modify application state

## Get started by choosing your AI backend

### Chat Suggestions
- Route: `/copilot-suggestions`
- Source: `docs/content/docs/(root)/copilot-suggestions.mdx`
- Description: Auto-generate suggestions in the chat window based on real-time application state.

## What is this?

Chat suggestions let you auto-generate contextual actions in the chat window based on real-time application state. The agent proposes relevant next steps that users can tap to execute instantly.

```tsx
  import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

  export function MyComponent() {
    useConfigureSuggestions({
      instructions: "Suggest the most relevant next actions.",
      minSuggestions: 1,
      maxSuggestions: 2,
    });
  }
```

## When should I use this?

Use chat suggestions when you want to:
- Guide users toward relevant actions based on current context
- Reduce friction by offering one-tap shortcuts
- Surface capabilities the user might not know about
