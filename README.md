<div align="center">
  <img src="./assets/banner.png" width="100%" style="border-radius: 15px;">
</div>

# CopilotKit🪁 [![Discord](https://dcbadge.vercel.app/api/server/6dffbvGU3D?compact=true&style=flat)](https://discord.gg/6dffbvGU3D) [![Online Users](https://img.shields.io/discord/1122926057641742418?label=online&logo=discord&logoColor=white&color=5865F2)](https://discord.gg/6dffbvGU3D) ![GitHub CI](https://github.com/RecursivelyAI/CopilotKit/actions/workflows/ci.yml/badge.svg)

A **powerful** & **hackable** copilot for any react app.  
Get started in minutes & iterate ad-infinitum.

## Overview

- ✅ **NEW:** `<CopilotTextarea />`: a drop-in `<textarea />` replacement with Copilot autocompletions.
- ✅ `useMakeCopilotReadable(...)`: Propagate granular app state to the Copilot & Textareas. 
- ✅ `useMakeCopilotActionable(...)`: Let the Copilot take _action_ on behalf of the user.
- 🚧 CopilotCloudKit: integrate arbitrary LLM logic / chains / RAG, using plain code.

## Demo

CopilotKit in action.

<p align="center">
  <img src="./assets/demo.gif" width="500" style="border-radius: 15px;">
</p>



## Installation

```bash
pnpm install @copilotkit/react-core @copilotkit/react-ui @copilotkit/react-textarea
```

## Examples

### NEW! `<CopilotTextarea />`
A drop-in <textarea /> replacement with context-aware Copilot autocompletions.

<p align="center">
  <img src="./assets/CopilotTextarea.gif" width="400" height="400" style="border-radius: 15px;">
</p>

#### Features
1. Customizable `purpose` prompt.
2. Provide arbitrary context to inform autocompletions using `useMakeCopilotReadable`
3. Works with any backend/LLM, using `ChatlikeApiEndpoint`
4. Supports all `<textarea />` customizations


```typescript
import "@copilotkit/react-textarea/styles.css"; // add to the app-global css
import { CopilotTextarea } from "@copilotkit/react-textarea";
import { CopilotProvider } from "@copilotkit/react-core";

// call ANYWHERE in your app to provide external context (make sure you wrap the app with a <CopilotProvider >):
// See below for more features (parent/child hierarchy, categories, etc.)
useMakeCopilotReadable(relevantInformation)

return (
  <CopilotProvider> {/* Global state & copilot logic. Put this around the entire app to propagate `useMakeCopilotReadable` calls */}
    <CopilotTextarea
      className="p-4 w-1/2 aspect-square font-bold text-3xl bg-slate-800 text-white rounded-lg resize-none"
      placeholder="A CopilotTextarea!"
      autosuggestionsConfig={{
        purposePrompt: "A COOL & SMOOTH announcement post about CopilotTextarea. Be brief. Be clear. Be cool.",
        apiEndpoint: apiEndpoint1 // (see below)
        forwardedParams: {
          max_tokens: 25,
          stop: ["\n", ".", ","],
        },
      }}
    />
  </CopilotProvider>
);
```

Easily use any backend/LLM via `ChatlikeApiEndpoint.custom(...)`, or just provide the URL of any OpenAI-comaptible endpoint:

```typescript
// If your endpoint is a standard OpenAI-compatible endpoint, just pass the URL (see `api/autosuggestions/route.ts` for an example)
const apiEndpoint1 = ChatlikeApiEndpoint.standardOpenAIEndpoint("/api/autosuggestions") 

// Or easily support any backend / LLM
const apiEndpoint2 = ChatlikeApiEndpoint.custom(
  async (
    abortSignal: AbortSignal,
    messages: MinimalChatGPTMessage[],
    forwardedProps?: { [key: string]: any },
  ) => {
    const res = await fetch('api/my-sreaming-api', {
      method: 'POST',
      body: JSON.stringify({
        ...forwardedProps,
        messages: messages,
        max_tokens: 5,
      }),
      signal: abortSignal,
    });

    const fullPayload = await res.text();
    return fullPayload;
  },
);
```

### Integrate copilot

```typescript
import "@copilotkit/react-ui/styles.css"; // add to the app-global css
import { CopilotProvider } from "@copilotkit/react-core";
import { CopilotSidebarUIProvider } from "@copilotkit/react-ui";

export default function App(): JSX.Element {
  return (
    <CopilotProvider> {/* Global state & copilot logic. Put this around the entire app */}
      <CopilotSidebarUIProvider> {/* A built-in Copilot UI (or bring your own UI). Put around individual pages, or the entire app. */}

        <YourContent />

      </CopilotSidebarUIProvider>
    </CopilotProvider>
  );
}
```

#### Features
1. Batteries included. Add 2 React components, and your Copilot is live.
2. Customize the built-in `CopilotSidebarUIProvider` UI -- or bring your own UI component.
3. Extremely hackable. Should the need arise, you can define 1st-class extensions just as powerful as `useMakeCopilotReadable`, `useMakeCopilotActionable`, etc.


### Give the copilot read permissions

#### Features
1. Propagate useful information & granular app-state to the Copilot
2. Easily maintain the hierarchical structure of information with `parentId`
3. One call to rule them all: `useMakeCopilotReadable` works both with the sidekick, and with CopilotTextarea.
   - Use the `contextCategories: string[]` param to route information to different places.


```typescript
import { useMakeCopilotReadable } from "@copilotkit/react-core";


function Employee(props: EmployeeProps): JSX.Element {
  const { employeeName, workProfile, metadata } = props;

  // propagate any information copilot
  const employeeContextId = useMakeCopilotReadable(employeeName);

  // Pass a parentID to maintain a hiearchical structure.
  // Especially useful with child React components, list elements, etc.
  useMakeCopilotReadable(workProfile.description(), employeeContextId);
  useMakeCopilotReadable(metadata.description(), employeeContextId);
  
  return (
    // Render as usual...
  );
}

```

### Give the copilot write permissions

```typescript
import { useMakeCopilotActionable } from "@copilotkit/react-core";

function Department(props: DepartmentProps): JSX.Element {
  // ...

  // Let the copilot take action on behalf of the user.
  useMakeCopilotActionable(
    {
      name: "setEmployeesAsSelected",
      description: "Set the given employees as 'selected'",
      argumentAnnotations: [
        {
          name: "employeeIds",
          type: "array", items: { type: "string" }
          description: "The IDs of employees to set as selected",
          required: true
        }
      ],
      implementation: async (employeeIds) => setEmployeesAsSelected(employeeIds),
    },
    []
  );

  // ...
}
```

#### Features
1. Plain typescript actions. Edit a textbox, navigate to a new page, or anythign you can think of.
2. Specify arbitrary input types.


## Near-Term Roadmap

### 📊 Please vote on features via the Issues tab!

### Copilot-App Interaction

- ✅ `useMakeCopilotReadable`: give static information to the copilot, in sync with on-screen state
- ✅ `useMakeCopilotActionable`: Let the copilot take action on behalf of the user
- 🚧 `useMakeCopilotAskable`: let the copilot ask for additional information when needed (coming soon)
- 🚧 `useEditCopilotMessage`: edit the (unsent) typed user message to the copilot (coming soon)
- 🚧 copilot-assisted navigation: go to the best page to achieve some objective.
- 🚧 CopilotCloudKit: integrate arbitrary LLM logic / chains / RAG, using plain code.

### UI components

- ✅ `<CopilotSidebarUIProvider>`: Built in, hackable Copilot UI (optional - you can bring your own UI).
- ✅ `<CopilotTextarea />`: drop-in `<textarea />` replacement with Copilot autocompletions.

### Integrations

- ✅ Vercel AI SDK
- ✅ OpenAI APIs
- 🚧 Langchain
- 🚧 Additional LLM providers

### Frameworks

- ✅ React
- 🚧 Vue
- 🚧 Svelte
- 🚧 Swift (Mac + iOS)

## Contribute

Contributions are welcome! 🎉

[Join the Discord](https://discord.gg/6dffbvGU3D)
[![Discord](https://dcbadge.vercel.app/api/server/6dffbvGU3D?compact=true&style=flat)](https://discord.gg/6dffbvGU3D)
<!-- [![Discord](https://img.shields.io/discord/1122926057641742418.svg)](https://discord.gg/6dffbvGU3D) -->

