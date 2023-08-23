<div align="center">
  <img src="./assets/banner.png" width="250">
</div>

# CopilotKit🪁 [![Discord](https://dcbadge.vercel.app/api/server/6dffbvGU3D?compact=true&style=flat)](https://discord.gg/6dffbvGU3D)

Add a powerful & hackable copilot to any app, in an afternoon.

## Demo

CopilotKit in action.

![Demo Gif](./assets/demo.gif)

## Installation

```bash
pnpm install @copilotkit/react-core @copilotkit/react-ui @copilotkit/react-textarea
```

## Examples

### NEW! CopilotTextarea

A drop-in <textarea /> replacement with context-aware Copilot autocompletions.

![CopilotTextarea Gif](./assets/CopilotTextarea.gif)

```typescript
import "@copilotkit/react-ui/styles.css"; // add to the app-global css
import { CopilotProvider } from "@copilotkit/react-core";
import { CopilotTextarea, MinimalChatGPTMessage, MakeSystemPrompt } from "@copilotkit/react-textarea";

  return (
    <CopilotProvider> {/* Global state & copilot logic. Put this around the entire app. */}
      <CopilotTextarea
        className="p-4 w-1/2 aspect-square font-bold text-3xl bg-slate-800 text-white rounded-lg resize-none"
        placeholder="A CopilotTextarea!"
        autosuggestionsConfig={{
          purposePrompt: "A COOL & SMOOTH announcement post about CopilotTextarea. Be brief. Be clear. Be cool.",
          externalContextCategories: ["someSpecificContextCategory"], // or leave as `undefined`, for the default global Copilot context
          apiEndpoint: "/api/autosuggestions" // API endpoint compatible with standard OPENAI endpoint
          forwardedParams: {
            max_tokens: 25,
            stop: ["\n", ".", ","],
          },
          // ... see `AutosuggestionsConfig` 
        }}
      />

    </CopilotProvider>
  );
```

Where `/api/autosuggestions` is any OpenAI-compatible endpoint. Here's an [example implementation](CopilotKit/examples/next-openai/src/app/api/autosuggestions/route.ts)


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

### Give the copilot read permissions

```typescript
import { useMakeCopilotReadable } from "@copilotkit/react-core";


function Employee(props: EmployeeProps): JSX.Element {
  const { employeeData, copilotParentPointer } = props;

  // Give the copilot information about this employee, and associate it with its parent department.
  useMakeCopilotReadable(employeeData.description(), copilotParentPointer);

  return (
    // Render as usual...
  );
}

function Department(props: DepartmentProps): JSX.Element {
  const { departmentData, employees } = props;

  // Give the copilot information about this department. Keep the pointer, to associate employees w departments.
  const departmentCopilotPointer = useMakeCopilotReadable(departmentData.description());

  return ( // Render as usual.
    <>      
      {employees.map((employeeData) => (
        <Employee copilotParentPointer={departmentCopilotPointer} employeeData={employeeData} />
      ))}
    </>
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


## Near-Term Roadmap

### 📊 Please vote on features via the Issues tab!

### Copilot-App Interaction

- ✅ `useMakeCopilotReadable`: give static information to the copilot, in sync with on-screen state
- ✅ `useMakeCopilotActionable`: Let the copilot take action on behalf of the user
- 🚧 `useMakeCopilotAskable`: let the copilot ask for additional information when needed (coming soon)
- 🚧 `useEditCopilotMessage`: edit the (unsent) typed user message to the copilot (coming soon)
- 🚧 copilot-assisted navigation: go to the best page to achieve some objective.

### UI components

- ✅ `<CopilotSidebarUIProvider>`: Built in, hackable Copilot UI (optional - you can bring your own UI).

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

