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
</p>

<p align="center">
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

<p align="center">
  <strong>Copilot support:</strong> We're happy to support your Copilot integration efforts. <br/>
  You can receive support on <a href="https://discord.gg/6dffbvGU3D">our discord</a>
   or by <a href="https://calendly.com/atai_/copilotkit" rel="dofollow"> booking a call with us</a>.
</p>

---

<h3 align="center">
  Building blocks for AI Copilots & AI-native Applications.
</h3>

<div align="center">
    Code-first & fully customizable. Use OpenAI or bring your own LLM. <br/>

</div>

---

<div align="center">
  <img src="https://github.com/CopilotKit/CopilotKit/assets/746397/32c896bc-0a22-42eb-9137-67da82f67708" width="900px" max-width="100%" style="border-radius: 35px;">
</div>
<br/>

🌟 **\<CopilotChat />:** <br />
Build **in-app AI chatbots** that can "see" the current app state + take action inside your app. <br />
The AI chatbot can talk to your app frontend & backend, and to 3rd party services (Salesforce, Dropbox, etc.) via plugins. <br />
AI "second brain" for your users, on tap.

🌟 **\<CopilotTextarea />:** <br />
AI-assisted text generation. Drop-in replacement for any `<textarea />.`<br />
Autocompletions + AI editing + generate from scratch. Indexed on your users' content.<br/>

## How does it work
**Define the following simple entry-points** into your application, and the CopilotKit🪁 execution engine takes care of the rest!
-  **Application state** (frontend + backend + 3rd party)
-  **Application interaction** (via plain typescript code, frontend + backend)
-  **Purpose-specific LLM chains**
-  **Application interaction** (via plain typescript code, frontend + backend)
-  and more.

CopilotKit also provides builit-in (fully-customizable) Copilot-native UX components, including: <br/>
`CopilotChat`, `CopilotSidebar`, `CopilotPopup`, and `CopilotTextarea`.


## Installation

```bash
npm i @copilotkit/react-core @copilotkit/react-ui @copilotkit/react-textarea
```

## Getting started

See quickstart in the [docs](https://docs.copilotkit.ai)

## Demo

**3-min showcase + 3-min implementation tutorial:**

[CopilotKit_Demo_Jan_zjgjk0.webm](https://github.com/CopilotKit/CopilotKit/assets/746397/b1749282-a3e4-4ef4-a780-7d03f30edf5b)


## Building blocks
A more comprehensive and up-to-date overview is available in the [docs](https://docs.copilotkit.ai). <br/>
But roughtly:

### Copilot entrypoints

- ✅ `useMakeCopilotReadable`: give frontend state to the copilot
- ✅ `useMakeCopilotDocumentReadable`: give document state to the copilot, especially useful with 3rd party state (e.g. Gong call transcript).
- ✅ `useMakeCopilotActionable`: frontend application interaction
- ✅ `CopilotBackend`: backend application interaction
- 🚧 `useCopilotChain`: provide usecase-specific LLM chains

### Built-in UI components

- ✅ `<CopilotSidebar>`: Built in, hackable Copilot UI (optional - you can bring your own UI).
- ✅ `<CopilotPopup>`: Built in popup UI.
- ✅ `<CopilotChat>`: Standalone chat UI
- ✅ `<CopilotTextarea />`: drop-in `<textarea />` replacement with Copilot autocompletions.
- ✅ `useCopilotChat()` for fully-custom UI component
- 🚧 use custom UX elements inside the chat (coming soon)




## Examples

### `<CopilotSidebar />`

```typescript
import "@copilotkit/react-ui/styles.css"; // add to the app-global css
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";

function MyAmazingContent() {
    const importantInfo = useImportantInfo()
    useMakeCopilotReadable("very importnat information: " + importantInfo)

    useMakeCopilotActionable(
      {
        name: `selectDestinations_${toCamelCase(heading)}`,
        description: `Set the given destinations as 'selected', on the ${heading} table`,
        argumentAnnotations: [
          {
            name: "destinationNames",
            type: "array",
            items: {
              type: "string",
            },
            description: "The names of the destinations to select",
            required: true,
          },
        ],
        implementation: async (destinationNames: string[]) => {
          setCheckedRows((prevState) => {
            const newState = { ...prevState };
            destinationNames.forEach((destinationName) => {
              newState[destinationName] = true;
            });
            return newState;
          });
        },
      },
      [],
    );


    return (
       <YourContent />
    )
}

export default function App() {
  return (
    <CopilotKit url="/api/copilotkit/chat"> {/* Global state & copilot logic. Put this around the entire app */}
      <CopilotSidebar> {/* A built-in Copilot UI (or bring your own UI). Put around individual pages, or the entire app. */}
        <MyAmazingContent />
      </CopilotSidebar>
    </CopilotKit>
  );
}
```

### `<CopilotTextarea />`

A drop-in <textarea /> replacement with autocompletions, AI insertions/edits, and generate-from-scratch. <br/>
Indexed on data provided to the Copilot.

<p align="center">
  <img src="./assets/CopilotTextarea.gif" width="648" style="border-radius: 15px; max-width="100%"">
</p>


```typescript
import "@copilotkit/react-textarea/styles.css"; // add to the app-global css
import { CopilotTextarea } from "@copilotkit/react-textarea";
import { CopilotKit } from "@copilotkit/react-core";

// call ANYWHERE in your app to provide external context (make sure you wrap the app with a <CopilotKit >):
// See below for more features (parent/child hierarchy, categories, etc.)
useMakeCopilotReadable(relevantInformation);
useMakeCopilotDocumentReadable(document);

return (
  <CopilotKit url="/api/copilotkit/chat"> {/* Global state & copilot logic. Put this around the entire app */}
    <CopilotTextarea
      className="p-4 w-1/2 aspect-square font-bold text-3xl bg-slate-800 text-white rounded-lg resize-none"
      placeholder="A CopilotTextarea!"
      autosuggestionsConfig={{
        purposePrompt:
          "A COOL & SMOOTH announcement post about CopilotTextarea. Be brief. Be clear. Be cool.",
        forwardedParams: {
          // additional arguments to customize autocompletions
          max_tokens: 25,
          stop: ["\n", ".", ","],
        },
      }}
    />
  </CopilotKit>
);
```


## Near-Term Roadmap

### 📊 Please vote on features via the Issues tab!

### Copilot-App Interaction

- ✅ `useMakeCopilotReadable`: give frontend state to the copilot
- ✅ `useMakeCopilotDocumentReadable`: give document state to the copilot, especially useful with 3rd party state (e.g. Gong call transcript)
- ✅ `useMakeCopilotActionable`: Let the copilot interact with the application
- 🚧 `useMakeCopilotAskable`: let the copilot ask for additional information when needed (coming soon)
- 🚧 `useCopilotChain`: provide usecase-specific chain
- 🚧 `useEditCopilotMessage`: edit the (unsent) typed user message to the copilot (coming soon)
- 🚧 copilot-assisted navigation: go to the best page to achieve some objective.
- 🚧 Copilot Cloud: From hosting, chat history, analytics, and evals, to automatic Copilot personalization and self-improvement.

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
