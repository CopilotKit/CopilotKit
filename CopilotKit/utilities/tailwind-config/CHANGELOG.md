# tailwind-config

## 1.3.16-undefined.0

### Patch Changes

- f6fab28: update tsup config
- f6fab28: update entry
- f6fab28: export langchain module
- 8a77944: Improve LangSmith support
- f6fab28: Ensure intermediate state config is sent as snake case
- f6fab28: update entry in tsup config
- 8a77944: Ensure the last message is sent to LangSmith
- f6fab28: update entry
- f6fab28: Update exports
- f6fab28: Update exports
- 332d744: Add support for Azure OpenAI
- f6fab28: Export LangGraph functions
- f6fab28: Update lockfile

## 1.3.15

### Patch Changes

- pass description for array and object action parameters in langchain adapter

## 1.3.14

### Patch Changes

- Add data-test-id to some elements for testing

## 1.3.13

### Patch Changes

- fix usage of one-at-a-time tool when called multiple times

## 1.3.12

### Patch Changes

- - enable dynamic parameters in langchain adapter tool call
  - fix unparsable action arguments causing tool call crashes

## 1.3.11

### Patch Changes

- 08e8956: Fix duplicate messages
- Fix duplicate messages

## 1.3.11-mme-fix-duplicate-messages.0

### Patch Changes

- Fix duplicate messages

## 1.3.10

### Patch Changes

- change how message chunk type is resolved (fixed langchain adapters)

## 1.3.9

### Patch Changes

- Fix message id issues

## 1.3.8

### Patch Changes

- fix textarea on multiple llm providers and memoize react ui context

## 1.3.7

### Patch Changes

- Fix libraries for React 19 and Next.js 15 support

## 1.3.6

### Patch Changes

- 1. Removes the usage of the `crypto` Node pacakge, instaed uses `uuid`. This ensures that non-Next.js React apps can use CopilotKit.
  2. Fixes Nest.js runtime docs

## 1.3.5

### Patch Changes

- Improve CoAgent state render

## 1.3.4

### Patch Changes

- Add followUp property to useCopilotAction

## 1.3.3

### Patch Changes

- Impvovements to error handling and CoAgent protocol

## 1.3.2

### Patch Changes

- Features and bug fixes
- 30232c0: Ensure actions can be discovered on state change

## 1.3.2-mme-discover-actions.0

### Patch Changes

- Ensure actions can be discovered on state change

## 1.3.1

### Patch Changes

- Revert CSS injection

## 1.3.0

### Minor Changes

- CoAgents and remote actions

### Patch Changes

- 5b63f55: stream intermediate state
- b6fd3d8: Better message grouping
- 89420c6: Rename hooks and bugfixes
- b6e8824: useCoAgent/useCoAgentAction
- 91c35b9: useAgentState
- 00be203: Remote actions preview
- fb15f72: Reduce request size by skipping intermediate state
- 8ecc3e4: Fix useCoAgent start/stop bug

## 1.2.1

### Patch Changes

- inject minified css in bundle

  - removes the need to import `styles.css` manually
  - empty `styles.css` included in the build for backwards compatibility
  - uses tsup's `injectStyles` with `postcss` to bundle and minify the CSS, then inject it as a style tag
  - currently uses my fork of `tsup` where I added support for async function in `injectStyles` (must-have for postcss), a PR from my fork to the main library will follow shortly
  - remove material-ui, and use `react-icons` for icons (same icons as before)
  - remove unused `IncludedFilesPreview` component
  - updated docs

## 1.2.0

### Minor Changes

- Fix errors related to crypto not being found, and other bug fixes

### Patch Changes

- 638d51d: appendMessage fix 1
- faccbe1: state-abuse resistance for useCopilotChat
- b0cf700: remove unnecessary logging

## 1.1.1

### Patch Changes

- - improved documentation
  - center textarea popup
  - show/hide dev console
  - forward maxTokens, stop and force function calling

## 1.1.0

### Minor Changes

- Official support for Groq (`GroqAdapter`)

## 1.0.3

### Patch Changes

- Dev console, bugfixes

## 1.0.2

### Patch Changes

- - Proactively prevent race conditions
  - Improve token counting performance

## 1.0.1

### Patch Changes

- Remove nanoid

## 1.0.0

### Major Changes

- b6a4b6eb: V1.0 Release Candidate

  - A robust new protocol between the frontend and the Copilot Runtime
  - Support for Copilot Cloud
  - Generative UI
  - Support for LangChain universal tool calling
  - OpenAI assistant API streaming

- V1.0 Release

  - A robust new protocol between the frontend and the Copilot Runtime
  - Support for Copilot Cloud
  - Generative UI
  - Support for LangChain universal tool calling
  - OpenAI assistant API streaming

## 1.0.0-beta.0

### Major Changes

- V1.0 Release Candidate

  - A robust new protocol between the frontend and the Copilot Runtime
  - Support for Copilot Cloud
  - Generative UI
  - Support for LangChain universal tool calling
  - OpenAI assistant API streaming

## 0.11.0

### Minor Changes

- f771353: Fix: Stale CopilotReadable
- 9df8d43: Remove unneeded tailwind components
- CSS improvements, useCopilotChat, invisible messages

## 0.11.0-mme-fix-textarea-css.1

### Minor Changes

- Remove unneeded tailwind components

## 0.11.0-mme-fix-feedback-readable.0

### Minor Changes

- Fix: Stale CopilotReadable

## 0.10.0

### Minor Changes

- 8baa862: Add push to talk prototype
- chat suggestions, standalone chat component, gemini adapter, push to talk

## 0.10.0-mme-push-to-talk.0

### Minor Changes

- Add push to talk prototype

## 0.9.0

### Minor Changes

- 718520b: gpt-4-turbo-april-2024 function calling fixes
- 95bcbd8: streamline cloud configuration
- 95bcbd8: Rename
- 95bcbd8: Upgrade langchain
- 95bcbd8: Support input guardrails (cloud)
- 95bcbd8: Unify api key handling
- CopilotCloud V1, useCopilotReadable and more...
- 95bcbd8: Get api key from headers dict
- 95bcbd8: Update comments
- 95bcbd8: Include reason in guardrails response
- 718520b: gpt-4-turbo-april-2024
- 95bcbd8: Update comments
- 5f6f57a: fix backend function calling return values
- 95bcbd8: Retrieve public API key

## 0.9.0-mme-cloud.7

### Minor Changes

- Get api key from headers dict

## 0.9.0-mme-cloud.6

### Minor Changes

- Upgrade langchain

## 0.9.0-mme-cloud.5

### Minor Changes

- Update comments

## 0.9.0-mme-cloud.4

### Minor Changes

- Update comments

## 0.9.0-mme-cloud.3

### Minor Changes

- 85c029b: streamline cloud configuration
- Rename
- a5ade3b: Support input guardrails (cloud)
- 12ff590: Unify api key handling
- f0c4745: Include reason in guardrails response
- 17f4b1b: Retrieve public API key

## 0.9.0-function-calling-fixes.2

### Minor Changes

- fix backend function calling return values

## 0.9.0-function-calling-fixes.1

### Minor Changes

- gpt-4-turbo-april-2024 function calling fixes

## 0.9.0-alpha.0

### Minor Changes

- gpt-4-turbo-april-2024

## 0.8.0

### Minor Changes

- 1f06d29: declare esm/cjs/types in export
- fix esm error
- 5a0b2cf: Inline codeblock style to avoid ESM error
- e12b921: ESM by default

## 0.8.0-mme-esm-error.2

### Minor Changes

- Inline codeblock style to avoid ESM error

## 0.8.0-mme-esm-error.1

### Minor Changes

- declare esm/cjs/types in export

## 0.8.0-mme-esm-error.0

### Minor Changes

- ESM by default

## 0.7.0

### Minor Changes

- 899aa6e: Backend improvements for running on GCP
- Improve streamHttpServerResponse for express and firebase apps

## 0.7.0-mme-firebase-fixes.0

### Minor Changes

- Backend improvements for running on GCP

## 0.6.0

### Minor Changes

- Improve Next.js support and action rendering

## 0.5.0

### Minor Changes

- c4010e7: Pre Release
- be00d61: Alpha
- ec8481c: Alpha
- 3fbee5d: OpenAIAdapter-getter
- e09dc44: Test backward compatibility of AnnotatedFunction on the backend
- 3f5ad60: OpenAIAdapter: make openai instance gettable
- 0dd6180: QA
- 225812d: QA new action type
- New actions: custom chat components, and typed arguments

## 0.5.0-mme-deprecate-annotated-function.4

### Minor Changes

- Test backward compatibility of AnnotatedFunction on the backend

## 0.5.0-mme-pre-release.3

### Minor Changes

- Pre Release
- 3fbee5d: OpenAIAdapter-getter
- 3f5ad60: OpenAIAdapter: make openai instance gettable

## 0.5.0-mme-function-call-labels.2

### Minor Changes

- be00d61: Alpha
- QA

## 0.5.0-mme-experimental-actions.1

### Minor Changes

- Alpha

## 0.5.0-mme-experimental-actions.0

### Minor Changes

- QA new action type

## 0.4.1

### Patch Changes

- 5ec8ad4: fix- bring back removeBackendOnlyProps
- 5a154d0: fix: bring back removeBackendOnlyProps
- fix: bring back removeBackendOnlyProps

## 0.4.1-atai-0223-fix-backendOnlyProps.1

### Patch Changes

- fix- bring back removeBackendOnlyProps

## 0.4.1-atai-0223-fix-backendOnlyProps.0

### Patch Changes

- fix: bring back removeBackendOnlyProps

## 0.4.0

### Minor Changes

- CopilotTask, function return values, LangChain support, LangServe support
- 401e474: Test the tools API
- 2f3296e: Test automation

## 0.4.0-beta-automation.1

### Minor Changes

- Test automation

## 0.4.0-tools.0

### Minor Changes

- Test the tools API

## 0.3.0

### Minor Changes

- node CopilotBackend support
- 58a8524: clean node example impl
- a34a226: node-native backend support

## 0.3.0-alpha.1

### Minor Changes

- clean node example impl

## 0.3.0-alpha.0

### Minor Changes

- node-native backend support

## 0.2.0

### Minor Changes

- eba87c7: .4
- 61168c7: no treeshake
- fb32fe3: .2
- eba87c7: .3
- new chatbot ui, new component names, new build system, new docs
- 61168c7: no treeshake take 2
- 61168c7: remove treeshake in build
- fb32fe3: build naming refactor
- eba87c7: .5
- 61168c7: cache clean
- fb32fe3: .3

## 0.2.0-alpha.8

### Minor Changes

- cache clean

## 0.2.0-alpha.7

### Minor Changes

- no treeshake

## 0.2.0-alpha.6

### Minor Changes

- no treeshake take 2

## 0.2.0-alpha.5

### Minor Changes

- remove treeshake in build

## 0.2.0-alpha.4

### Minor Changes

- .5

## 0.2.0-alpha.3

### Minor Changes

- .4

## 0.2.0-alpha.2

### Minor Changes

- .3

## 0.2.0-alpha.1

### Minor Changes

- .2
- .3

## 0.2.0-alpha.0

### Minor Changes

- build naming refactor

## 0.1.0

### Minor Changes

- working version
- 9d2f3cb: semi compiling
