
<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://github.com/CopilotKit/CopilotKit/assets/746397/5890217b-524e-49c5-a89e-b8743d2acd51">
    <img alt="CopilotKit Logo" src="https://github.com/CopilotKit/CopilotKit/assets/746397/bd5c9079-929b-4d55-bdc9-16d1c8181b71" width="450px" max-width="100%"/>
  </picture>
  </a>
</div>

<p align="center">
  <a href="https://discord.gg/6dffbvGU3D">
      <img src="https://dcbadge.vercel.app/api/server/6dffbvGU3D?compact=true&style=flat" alt="Discord">
  </a>
  <a href="https://github.com/CopilotKit/CopilotKit/actions/workflows/ci.yml">
      <img src="https://github.com/CopilotKit/CopilotKit/actions/workflows/ci.yml/badge.svg" alt="GitHub CI">
  </a>

  <a href="https://www.npmjs.com/package/@copilotkit/react-core">
    <img src="https://img.shields.io/npm/v/@copilotkit/react-core" alt="NPM">
  <img src="https://img.shields.io/github/license/CopilotKit/CopilotKit" alt="MIT">
  
</p>


<h1 align="center">
The Open-Source Copilot Platform
</h1>

<h3 align="center">
in-app chatbots, and AI-enabled Textareas.
</h3>

<div align="center">
  <picture>
    <img alt="Backed by Techstars" src="https://github.com/CopilotKit/CopilotKit/assets/746397/a5029e89-0986-4dfc-bbd6-61d18944ae59" width="150px" max-width="100%"/>
  </picture>
  </a>
</div>


<p align="center">
  <br />
    <a href="https://docs.copilotkit.ai" rel="dofollow"><strong>Explore the docs »</strong></a>
  <br />

  <br/>
    <a href="https://discord.gg/6dffbvGU3D">Join our Discord</a>
    ·
    <a href="https://copilotkit.ai?utm_medium=github&utm_source=github">Website</a>
    ·
    <a href="https://github.com/CopilotKit/CopilotKit/issues/new?assignees=&labels=bug&projects=&template=bug_report.md&title=">Report Bug</a>
    ·
    <a href="https://github.com/CopilotKit/CopilotKit/issues/new?assignees=&labels=feature+request&projects=&template=feature_request.md&title=">Request Feature</a>
</p>

 <p align="center">
   Questions?
    <a href="https://calendly.com/atai_/copilotkit" rel="dofollow"><strong> Book a call with us  »</strong></a>
    <br />
</p>
  


<div align="center">
  <img src="https://github.com/CopilotKit/CopilotKit/assets/746397/1aa17608-46a5-4e2f-aad5-19c8f5c5f1bd" width="900px" max-width="100%" style="border-radius: 35px;">
</div>
<br/>

🌟 **\<CopilotPortal />:** <br />
Build **in-app AI chatbots** that can "see" the current app state + take action inside your app. <br />
The AI chatbot can talk to your app frontend & backend, and to 3rd party services (Salesforce, Dropbox, etc.) via plugins. <br />
AI "second brain" for your users, on tap.

🌟 **\<CopilotTextarea />:** <br />
AI-assisted text generation. Drop-in replacement for any `<textarea />.`<br />
Autocompletions + AI editing + generate from scratch. Indexed on your users' content.<br/>
Starting with React. Use any LLM. <br/>

Combines frontend SDKs, backend SDKs, and (optional) cloud infrastructure. Open-source 🪁


## Installation

```bash
npm i @copilotkit/react-core @copilotkit/react-ui @copilotkit/react-textarea
```


## Getting started
See quickstart in the [docs](https://docs.copilotkit.ai)


## 🎯 Features Overview

### CopilotTextarea: AI-assisted text generation + editing.
- ✅ A a drop-in `<textarea />` replacement. Supports all `<textarea />` customizations.
- ✅ Context-aware autocompletions ✨ (like in GitHub Copilot)
- ✅ AI editing ✨ - "list the client's top 3 pain points from the last call using @SalesforceData"
- 🟩 Generate from scratch ✨ - automatically populate the initial content based on given context
- ✅ App context & 3rd party context with `useMakeCopilotReadable` and `useMakeCopilotDocumentReadable`
- ✅ Fully customizable prompt engineering
- 🟩 Arbitrary LLM chains.
- 🟩 Bold + italics.


### Copilot Chatbot: (frontend + backend) runtimes for in-app copilots.
- ✅ Index on frontend app state (via `useMakeCopilotReadable` and `useMakeCopilotDocumentReadable`)
- 🟩 Index on backend state
- ✅ frontend function calling runtime (in-app actions) (via `useMakeCopilotActionable`)
- 🟩 backend function calling runtime (auth enabled)
- 🟩 Autorun vs. "sensitive" functions (require user approval before execution).
- ✅ Cursor-style @document-referecing.
- ✅ Bring your own model
- 🟩 3rd party plugins
- 🟩 execute arbitrary LLM chains
- 🟩 OpenAI _assistants_ api
- ✅ Fully customize UI

## Demo
**2-min showcase + 2-min implementation tutorial:**

https://github.com/CopilotKit/CopilotKit/assets/746397/b0cdf38b-ec5c-4e95-8623-364bafb70907






## Examples

### `<CopilotTextarea />`
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
useMakeCopilotDocumentReadable(document)

return (
  <CopilotProvider chatApiEndpoint="/api/copilotkit/chat"> {/* Global state & copilot logic. Put this around the entire app */}
    <CopilotTextarea
      className="p-4 w-1/2 aspect-square font-bold text-3xl bg-slate-800 text-white rounded-lg resize-none"
      placeholder="A CopilotTextarea!"
      autosuggestionsConfig={{
        purposePrompt: "A COOL & SMOOTH announcement post about CopilotTextarea. Be brief. Be clear. Be cool.",
        forwardedParams: { // additional arguments to customize autocompletions
          max_tokens: 25,
          stop: ["\n", ".", ","],
        },
      }}
    />
  </CopilotProvider>
);
```


### Integrate copilot

```typescript
import "@copilotkit/react-ui/styles.css"; // add to the app-global css
import { CopilotProvider } from "@copilotkit/react-core";
import { CopilotSidebarUIProvider } from "@copilotkit/react-ui";

export default function App(): JSX.Element {
  return (
  <CopilotProvider chatApiEndpoint="/api/copilotkit/chat"> {/* Global state & copilot logic. Put this around the entire app */}
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
      name: "setEmployeesAsSelected", // no spaces allowed in the function name
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

## Contact

atai `<at>` copilotkit.ai

