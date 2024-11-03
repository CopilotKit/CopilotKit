# ui

## 1.3.11

### Patch Changes

- 08e8956: Fix duplicate messages
- Fix duplicate messages
- Updated dependencies [08e8956]
- Updated dependencies
  - @copilotkit/react-core@1.3.11
  - @copilotkit/runtime-client-gql@1.3.11
  - @copilotkit/shared@1.3.11

## 1.3.11-mme-fix-duplicate-messages.0

### Patch Changes

- Fix duplicate messages
- Updated dependencies
  - @copilotkit/react-core@1.3.11-mme-fix-duplicate-messages.0
  - @copilotkit/runtime-client-gql@1.3.11-mme-fix-duplicate-messages.0
  - @copilotkit/shared@1.3.11-mme-fix-duplicate-messages.0

## 1.3.10

### Patch Changes

- change how message chunk type is resolved (fixed langchain adapters)
- Updated dependencies
  - @copilotkit/react-core@1.3.10
  - @copilotkit/runtime-client-gql@1.3.10
  - @copilotkit/shared@1.3.10

## 1.3.9

### Patch Changes

- Fix message id issues
- Updated dependencies
  - @copilotkit/react-core@1.3.9
  - @copilotkit/runtime-client-gql@1.3.9
  - @copilotkit/shared@1.3.9

## 1.3.8

### Patch Changes

- fix textarea on multiple llm providers and memoize react ui context
- Updated dependencies
  - @copilotkit/react-core@1.3.8
  - @copilotkit/runtime-client-gql@1.3.8
  - @copilotkit/shared@1.3.8

## 1.3.7

### Patch Changes

- Fix libraries for React 19 and Next.js 15 support
- Updated dependencies
  - @copilotkit/react-core@1.3.7
  - @copilotkit/runtime-client-gql@1.3.7
  - @copilotkit/shared@1.3.7

## 1.3.6

### Patch Changes

- 1. Removes the usage of the `crypto` Node pacakge, instaed uses `uuid`. This ensures that non-Next.js React apps can use CopilotKit.
  2. Fixes Nest.js runtime docs

- Updated dependencies
  - @copilotkit/react-core@1.3.6
  - @copilotkit/runtime-client-gql@1.3.6
  - @copilotkit/shared@1.3.6

## 1.3.5

### Patch Changes

- Improve CoAgent state render
- Updated dependencies
  - @copilotkit/react-core@1.3.5
  - @copilotkit/runtime-client-gql@1.3.5
  - @copilotkit/shared@1.3.5

## 1.3.4

### Patch Changes

- Add followUp property to useCopilotAction
- Updated dependencies
  - @copilotkit/react-core@1.3.4
  - @copilotkit/runtime-client-gql@1.3.4
  - @copilotkit/shared@1.3.4

## 1.3.3

### Patch Changes

- Impvovements to error handling and CoAgent protocol
- Updated dependencies
  - @copilotkit/react-core@1.3.3
  - @copilotkit/runtime-client-gql@1.3.3
  - @copilotkit/shared@1.3.3

## 1.3.2

### Patch Changes

- Features and bug fixes
- 30232c0: Ensure actions can be discovered on state change
- Updated dependencies
- Updated dependencies [30232c0]
  - @copilotkit/react-core@1.3.2
  - @copilotkit/runtime-client-gql@1.3.2
  - @copilotkit/shared@1.3.2

## 1.3.2-mme-discover-actions.0

### Patch Changes

- Ensure actions can be discovered on state change
- Updated dependencies
  - @copilotkit/react-core@1.3.2-mme-discover-actions.0
  - @copilotkit/runtime-client-gql@1.3.2-mme-discover-actions.0
  - @copilotkit/shared@1.3.2-mme-discover-actions.0

## 1.3.1

### Patch Changes

- Revert CSS injection
- Updated dependencies
  - @copilotkit/react-core@1.3.1
  - @copilotkit/runtime-client-gql@1.3.1
  - @copilotkit/shared@1.3.1

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
- Updated dependencies
- Updated dependencies [5b63f55]
- Updated dependencies [b6fd3d8]
- Updated dependencies [89420c6]
- Updated dependencies [b6e8824]
- Updated dependencies [91c35b9]
- Updated dependencies [00be203]
- Updated dependencies [fb15f72]
- Updated dependencies [8ecc3e4]
  - @copilotkit/react-core@1.3.0
  - @copilotkit/runtime-client-gql@1.3.0
  - @copilotkit/shared@1.3.0

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

- Updated dependencies
  - @copilotkit/react-core@1.2.1
  - @copilotkit/runtime-client-gql@1.2.1
  - @copilotkit/shared@1.2.1

## 1.2.0

### Minor Changes

- Fix errors related to crypto not being found, and other bug fixes

### Patch Changes

- 638d51d: appendMessage fix 1
- faccbe1: state-abuse resistance for useCopilotChat
- b0cf700: remove unnecessary logging
- Updated dependencies
- Updated dependencies [638d51d]
- Updated dependencies [faccbe1]
- Updated dependencies [b0cf700]
  - @copilotkit/react-core@1.2.0
  - @copilotkit/runtime-client-gql@1.2.0
  - @copilotkit/shared@1.2.0

## 1.1.2

### Patch Changes

- Pin headless-ui/react version to v2.1.1
- Updated dependencies
  - @copilotkit/react-core@1.1.2
  - @copilotkit/runtime-client-gql@1.1.2
  - @copilotkit/shared@1.1.2

## 1.1.1

### Patch Changes

- - improved documentation
  - center textarea popup
  - show/hide dev console
  - forward maxTokens, stop and force function calling
- Updated dependencies
  - @copilotkit/react-core@1.1.1
  - @copilotkit/runtime-client-gql@1.1.1
  - @copilotkit/shared@1.1.1

## 1.1.0

### Minor Changes

- Official support for Groq (`GroqAdapter`)

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@1.1.0
  - @copilotkit/runtime-client-gql@1.1.0
  - @copilotkit/shared@1.1.0

## 1.0.9

### Patch Changes

- Dev console, bugfixes
- Updated dependencies
  - @copilotkit/react-core@1.0.9
  - @copilotkit/runtime-client-gql@1.0.9
  - @copilotkit/shared@1.0.9

## 1.0.8

### Patch Changes

- Remove redundant console logs
- Updated dependencies
  - @copilotkit/react-core@1.0.8
  - @copilotkit/runtime-client-gql@1.0.8
  - @copilotkit/shared@1.0.8

## 1.0.7

### Patch Changes

- Add \_copilotkit internal properties to runtime
- Updated dependencies
  - @copilotkit/react-core@1.0.7
  - @copilotkit/runtime-client-gql@1.0.7
  - @copilotkit/shared@1.0.7

## 1.0.6

### Patch Changes

- - Proactively prevent race conditions
  - Improve token counting performance
- Updated dependencies
  - @copilotkit/react-core@1.0.6
  - @copilotkit/runtime-client-gql@1.0.6
  - @copilotkit/shared@1.0.6

## 1.0.5

### Patch Changes

- Include @copilotkit/runtime-client-gql NPM package version in request to Runtime
- Updated dependencies
  - @copilotkit/react-core@1.0.5
  - @copilotkit/runtime-client-gql@1.0.5
  - @copilotkit/shared@1.0.5

## 1.0.4

### Patch Changes

- Remove nanoid
- Updated dependencies
  - @copilotkit/react-core@1.0.4
  - @copilotkit/runtime-client-gql@1.0.4
  - @copilotkit/shared@1.0.4

## 1.0.3

### Patch Changes

- Add README.md to published packages and add keywords to package.json
- Updated dependencies
  - @copilotkit/react-core@1.0.3
  - @copilotkit/runtime-client-gql@1.0.3
  - @copilotkit/shared@1.0.3

## 1.0.2

### Patch Changes

- Add README.md and homepage/url to published packages
- Updated dependencies
  - @copilotkit/react-core@1.0.2
  - @copilotkit/runtime-client-gql@1.0.2
  - @copilotkit/shared@1.0.2

## 1.0.1

### Patch Changes

- Remove PostHog, use Segment Anonymous Telemetry instead
- Updated dependencies
  - @copilotkit/react-core@1.0.1
  - @copilotkit/runtime-client-gql@1.0.1
  - @copilotkit/shared@1.0.1

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

### Patch Changes

- b6a4b6eb: Introduce anonymous telemetry
- b6a4b6eb: Set default Copilot Cloud runtime URL to versioned URL (v1)
- Updated dependencies [b6a4b6eb]
- Updated dependencies [b6a4b6eb]
- Updated dependencies [b6a4b6eb]
- Updated dependencies
  - @copilotkit/react-core@1.0.0
  - @copilotkit/runtime-client-gql@1.0.0
  - @copilotkit/shared@1.0.0

## 1.0.0-beta.2

### Patch Changes

- Set default Copilot Cloud runtime URL to versioned URL (v1)
- Updated dependencies
  - @copilotkit/runtime-client-gql@1.0.0-beta.2
  - @copilotkit/react-core@1.0.0-beta.2
  - @copilotkit/shared@1.0.0-beta.2

## 1.0.0-beta.1

### Patch Changes

- Introduce anonymous telemetry
- Updated dependencies
  - @copilotkit/runtime-client-gql@1.0.0-beta.1
  - @copilotkit/react-core@1.0.0-beta.1
  - @copilotkit/shared@1.0.0-beta.1

## 1.0.0-beta.0

### Major Changes

- V1.0 Release Candidate

  - A robust new protocol between the frontend and the Copilot Runtime
  - Support for Copilot Cloud
  - Generative UI
  - Support for LangChain universal tool calling
  - OpenAI assistant API streaming

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@1.0.0-beta.0
  - @copilotkit/runtime-client-gql@1.0.0-beta.0
  - @copilotkit/shared@1.0.0-beta.0

## 0.37.0

### Minor Changes

- f771353: Fix: Stale CopilotReadable
- 9df8d43: Remove unneeded tailwind components
- CSS improvements, useCopilotChat, invisible messages

### Patch Changes

- Updated dependencies [f771353]
- Updated dependencies [9df8d43]
- Updated dependencies
  - @copilotkit/react-core@0.37.0
  - @copilotkit/shared@0.37.0

## 0.37.0-mme-fix-textarea-css.1

### Minor Changes

- Remove unneeded tailwind components

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.37.0-mme-fix-textarea-css.1
  - @copilotkit/shared@0.37.0-mme-fix-textarea-css.1

## 0.37.0-mme-fix-feedback-readable.0

### Minor Changes

- Fix: Stale CopilotReadable

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.37.0-mme-fix-feedback-readable.0
  - @copilotkit/shared@0.37.0-mme-fix-feedback-readable.0

## 0.36.0

### Minor Changes

- 8baa862: Add push to talk prototype
- chat suggestions, standalone chat component, gemini adapter, push to talk

### Patch Changes

- Updated dependencies [8baa862]
- Updated dependencies
  - @copilotkit/react-core@0.36.0
  - @copilotkit/shared@0.36.0

## 0.36.0-mme-push-to-talk.0

### Minor Changes

- Add push to talk prototype

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.36.0-mme-push-to-talk.0
  - @copilotkit/shared@0.36.0-mme-push-to-talk.0

## 0.35.0

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

### Patch Changes

- Updated dependencies [718520b]
- Updated dependencies [95bcbd8]
- Updated dependencies [95bcbd8]
- Updated dependencies [95bcbd8]
- Updated dependencies [95bcbd8]
- Updated dependencies [95bcbd8]
- Updated dependencies
- Updated dependencies [95bcbd8]
- Updated dependencies [95bcbd8]
- Updated dependencies [95bcbd8]
- Updated dependencies [718520b]
- Updated dependencies [95bcbd8]
- Updated dependencies [5f6f57a]
- Updated dependencies [95bcbd8]
  - @copilotkit/react-core@0.25.0
  - @copilotkit/shared@0.9.0

## 0.35.0-mme-cloud.7

### Minor Changes

- Get api key from headers dict

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.25.0-mme-cloud.7
  - @copilotkit/shared@0.9.0-mme-cloud.7

## 0.35.0-mme-cloud.6

### Minor Changes

- Upgrade langchain

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.25.0-mme-cloud.6
  - @copilotkit/shared@0.9.0-mme-cloud.6

## 0.35.0-mme-cloud.5

### Minor Changes

- Update comments

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.25.0-mme-cloud.5
  - @copilotkit/shared@0.9.0-mme-cloud.5

## 0.35.0-mme-cloud.4

### Minor Changes

- Update comments

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.25.0-mme-cloud.4
  - @copilotkit/shared@0.9.0-mme-cloud.4

## 0.35.0-mme-cloud.3

### Minor Changes

- 85c029b: streamline cloud configuration
- Rename
- a5ade3b: Support input guardrails (cloud)
- 12ff590: Unify api key handling
- f0c4745: Include reason in guardrails response
- 17f4b1b: Retrieve public API key

### Patch Changes

- Updated dependencies [85c029b]
- Updated dependencies
- Updated dependencies [a5ade3b]
- Updated dependencies [12ff590]
- Updated dependencies [f0c4745]
- Updated dependencies [17f4b1b]
  - @copilotkit/react-core@0.25.0-mme-cloud.3
  - @copilotkit/shared@0.9.0-mme-cloud.3

## 0.35.0-function-calling-fixes.2

### Minor Changes

- fix backend function calling return values

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.25.0-function-calling-fixes.2
  - @copilotkit/shared@0.9.0-function-calling-fixes.2

## 0.35.0-function-calling-fixes.1

### Minor Changes

- gpt-4-turbo-april-2024 function calling fixes

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.25.0-function-calling-fixes.1
  - @copilotkit/shared@0.9.0-function-calling-fixes.1

## 0.35.0-alpha.0

### Minor Changes

- gpt-4-turbo-april-2024

### Patch Changes

- Updated dependencies
  - @copilotkit/shared@0.9.0-alpha.0
  - @copilotkit/react-core@0.25.0-alpha.0

## 0.34.0

### Minor Changes

- 1f06d29: declare esm/cjs/types in export
- fix esm error
- 5a0b2cf: Inline codeblock style to avoid ESM error
- e12b921: ESM by default

### Patch Changes

- Updated dependencies [1f06d29]
- Updated dependencies
- Updated dependencies [5a0b2cf]
- Updated dependencies [e12b921]
  - @copilotkit/react-core@0.24.0
  - @copilotkit/shared@0.8.0

## 0.34.0-mme-esm-error.2

### Minor Changes

- Inline codeblock style to avoid ESM error

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.24.0-mme-esm-error.2
  - @copilotkit/shared@0.8.0-mme-esm-error.2

## 0.34.0-mme-esm-error.1

### Minor Changes

- declare esm/cjs/types in export

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.24.0-mme-esm-error.1
  - @copilotkit/shared@0.8.0-mme-esm-error.1

## 0.34.0-mme-esm-error.0

### Minor Changes

- ESM by default

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.24.0-mme-esm-error.0
  - @copilotkit/shared@0.8.0-mme-esm-error.0

## 0.33.0

### Minor Changes

- 899aa6e: Backend improvements for running on GCP
- Improve streamHttpServerResponse for express and firebase apps

### Patch Changes

- Updated dependencies [899aa6e]
- Updated dependencies
  - @copilotkit/react-core@0.23.0
  - @copilotkit/shared@0.7.0

## 0.33.0-mme-firebase-fixes.0

### Minor Changes

- Backend improvements for running on GCP

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.23.0-mme-firebase-fixes.0
  - @copilotkit/shared@0.7.0-mme-firebase-fixes.0

## 0.32.0

### Minor Changes

- Improve Next.js support and action rendering

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.22.0
  - @copilotkit/shared@0.6.0

## 0.31.0

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

### Patch Changes

- Updated dependencies [c4010e7]
- Updated dependencies [be00d61]
- Updated dependencies [ec8481c]
- Updated dependencies [3fbee5d]
- Updated dependencies [e09dc44]
- Updated dependencies [3f5ad60]
- Updated dependencies [0dd6180]
- Updated dependencies [225812d]
- Updated dependencies
  - @copilotkit/react-core@0.21.0
  - @copilotkit/shared@0.5.0

## 0.31.0-mme-deprecate-annotated-function.4

### Minor Changes

- Test backward compatibility of AnnotatedFunction on the backend

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.21.0-mme-deprecate-annotated-function.4
  - @copilotkit/shared@0.5.0-mme-deprecate-annotated-function.4

## 0.31.0-mme-pre-release.3

### Minor Changes

- Pre Release
- 3fbee5d: OpenAIAdapter-getter
- 3f5ad60: OpenAIAdapter: make openai instance gettable

### Patch Changes

- Updated dependencies
- Updated dependencies [3fbee5d]
- Updated dependencies [3f5ad60]
  - @copilotkit/react-core@0.21.0-mme-pre-release.3
  - @copilotkit/shared@0.5.0-mme-pre-release.3

## 0.31.0-mme-function-call-labels.2

### Minor Changes

- be00d61: Alpha
- QA

### Patch Changes

- Updated dependencies [be00d61]
- Updated dependencies
  - @copilotkit/react-core@0.21.0-mme-function-call-labels.2
  - @copilotkit/shared@0.5.0-mme-function-call-labels.2

## 0.31.0-mme-experimental-actions.1

### Minor Changes

- Alpha

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.21.0-mme-experimental-actions.1
  - @copilotkit/shared@0.5.0-mme-experimental-actions.1

## 0.31.0-mme-experimental-actions.0

### Minor Changes

- QA new action type

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.21.0-mme-experimental-actions.0
  - @copilotkit/shared@0.5.0-mme-experimental-actions.0

## 0.30.1

### Patch Changes

- 5ec8ad4: fix- bring back removeBackendOnlyProps
- 5a154d0: fix: bring back removeBackendOnlyProps
- fix: bring back removeBackendOnlyProps
- Updated dependencies [5ec8ad4]
- Updated dependencies [5a154d0]
- Updated dependencies
  - @copilotkit/react-core@0.20.1
  - @copilotkit/shared@0.4.1

## 0.30.1-atai-0223-fix-backendOnlyProps.1

### Patch Changes

- fix- bring back removeBackendOnlyProps
- Updated dependencies
  - @copilotkit/react-core@0.20.1-atai-0223-fix-backendOnlyProps.1
  - @copilotkit/shared@0.4.1-atai-0223-fix-backendOnlyProps.1

## 0.30.1-atai-0223-fix-backendOnlyProps.0

### Patch Changes

- fix: bring back removeBackendOnlyProps
- Updated dependencies
  - @copilotkit/react-core@0.20.1-atai-0223-fix-backendOnlyProps.0
  - @copilotkit/shared@0.4.1-atai-0223-fix-backendOnlyProps.0

## 0.30.0

### Minor Changes

- CopilotTask, function return values, LangChain support, LangServe support
- 401e474: Test the tools API
- 2f3296e: Test automation

### Patch Changes

- Updated dependencies
- Updated dependencies [401e474]
- Updated dependencies [2f3296e]
  - @copilotkit/react-core@0.20.0
  - @copilotkit/shared@0.4.0

## 0.30.0-beta-automation.1

### Minor Changes

- Test automation

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.20.0-beta-automation.1
  - @copilotkit/shared@0.4.0-beta-automation.1

## 0.30.0-tools.0

### Minor Changes

- Test the tools API

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.20.0-tools.0
  - @copilotkit/shared@0.4.0-tools.0

## 0.29.0

### Minor Changes

- node CopilotBackend support
- 58a8524: clean node example impl
- a34a226: node-native backend support

### Patch Changes

- Updated dependencies
- Updated dependencies [58a8524]
- Updated dependencies [a34a226]
  - @copilotkit/react-core@0.19.0
  - @copilotkit/shared@0.3.0

## 0.29.0-alpha.1

### Minor Changes

- clean node example impl

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.19.0-alpha.1
  - @copilotkit/shared@0.3.0-alpha.1

## 0.29.0-alpha.0

### Minor Changes

- node-native backend support

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.19.0-alpha.0
  - @copilotkit/shared@0.3.0-alpha.0

## 0.28.0

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

### Patch Changes

- Updated dependencies [eba87c7]
- Updated dependencies [29ee27e]
- Updated dependencies [61168c7]
- Updated dependencies [fb32fe3]
- Updated dependencies [eba87c7]
- Updated dependencies
- Updated dependencies [61168c7]
- Updated dependencies [61168c7]
- Updated dependencies [fb32fe3]
- Updated dependencies [eba87c7]
- Updated dependencies [61168c7]
- Updated dependencies [fb32fe3]
  - @copilotkit/react-core@0.18.0
  - @copilotkit/shared@0.2.0

## 0.28.0-alpha.9

### Minor Changes

- cache clean

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.18.0-alpha.9
  - @copilotkit/shared@0.2.0-alpha.8

## 0.28.0-alpha.8

### Minor Changes

- no treeshake

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.18.0-alpha.8
  - @copilotkit/shared@0.2.0-alpha.7

## 0.28.0-alpha.7

### Minor Changes

- no treeshake take 2

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.18.0-alpha.7
  - @copilotkit/shared@0.2.0-alpha.6

## 0.28.0-alpha.6

### Minor Changes

- remove treeshake in build

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.18.0-alpha.6
  - @copilotkit/shared@0.2.0-alpha.5

## 0.28.0-alpha.5

### Minor Changes

- .5

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.18.0-alpha.5
  - @copilotkit/shared@0.2.0-alpha.4

## 0.28.0-alpha.4

### Minor Changes

- .4

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.18.0-alpha.4
  - @copilotkit/shared@0.2.0-alpha.3

## 0.28.0-alpha.3

### Minor Changes

- .3

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.18.0-alpha.3
  - @copilotkit/shared@0.2.0-alpha.2

## 0.28.0-alpha.2

### Minor Changes

- .2
- .3

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @copilotkit/react-core@0.18.0-alpha.2
  - @copilotkit/shared@0.2.0-alpha.1

## 0.28.0-alpha.1

### Minor Changes

- build naming refactor

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.18.0-alpha.1
  - @copilotkit/shared@0.2.0-alpha.0

## 0.27.2-alpha.0

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.18.0-alpha.0

## 0.27.1

### Patch Changes

- stop generating button working
- aa6bc5a: fix stop generate
- cf0bde6: change order of operations on stop cleanup
- Updated dependencies
- Updated dependencies [aa6bc5a]
- Updated dependencies [cf0bde6]
  - @copilotkit/react-core@0.17.1

## 0.27.1-alpha.1

### Patch Changes

- change order of operations on stop cleanup
- Updated dependencies
  - @copilotkit/react-core@0.17.1-alpha.1

## 0.27.1-alpha.0

### Patch Changes

- fix stop generate
- Updated dependencies
  - @copilotkit/react-core@0.17.1-alpha.0

## 0.27.0

### Minor Changes

- factor useChat into internal core
- a7b417a: insertion default prompt update
- 88d6654: release useChat fixes
- 51de9d5: textarea editing: default prompt + few shot update
- fa84257: remove vercel ai
- 98a37c8: strictly propagate copilot api params through the fetch arguments - not through any constructors
- 250032d: useChat: do not separately propagate options.url to constructor

### Patch Changes

- Updated dependencies
- Updated dependencies [a7b417a]
- Updated dependencies [88d6654]
- Updated dependencies [51de9d5]
- Updated dependencies [fa84257]
- Updated dependencies [98a37c8]
- Updated dependencies [250032d]
  - @copilotkit/react-core@0.17.0

## 0.27.0-alpha.5

### Minor Changes

- release useChat fixes

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.17.0-alpha.5

## 0.27.0-alpha.4

### Minor Changes

- insertion default prompt update

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.17.0-alpha.4

## 0.27.0-alpha.3

### Minor Changes

- textarea editing: default prompt + few shot update

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.17.0-alpha.3

## 0.27.0-alpha.2

### Minor Changes

- useChat: do not separately propagate options.url to constructor

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.17.0-alpha.2

## 0.27.0-alpha.1

### Minor Changes

- strictly propagate copilot api params through the fetch arguments - not through any constructors

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.17.0-alpha.1

## 0.27.0-alpha.0

### Minor Changes

- remove vercel ai

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.17.0-alpha.0

## 0.26.1

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.16.0

## 0.26.0

### Minor Changes

- 8a5cecd: only forward functions if non-empty
- 87f1fa0: rebase
- 15d4afc: debugging
- c40a0d1: Filter out empty function descriptions
- prep for chat protocol v2
- bbd152e: backend sdks prep
- 8517bb1: trying again
- 478840a: carry function propagation fix to chat v2

### Patch Changes

- Updated dependencies [8a5cecd]
- Updated dependencies [87f1fa0]
- Updated dependencies [15d4afc]
- Updated dependencies [c40a0d1]
- Updated dependencies
- Updated dependencies [bbd152e]
- Updated dependencies [8517bb1]
- Updated dependencies [478840a]
  - @copilotkit/react-core@0.15.0

## 0.26.0-alpha.6

### Minor Changes

- rebase

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.15.0-alpha.6

## 0.26.0-alpha.5

### Minor Changes

- carry function propagation fix to chat v2

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.15.0-alpha.5

## 0.26.0-alpha.4

### Minor Changes

- only forward functions if non-empty

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.15.0-alpha.4

## 0.26.0-alpha.3

### Minor Changes

- debugging

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.15.0-alpha.3

## 0.26.0-alpha.2

### Minor Changes

- trying again

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.15.0-alpha.2

## 0.26.0-alpha.1

### Minor Changes

- Filter out empty function descriptions

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.15.0-alpha.1

## 0.26.0-alpha.0

### Minor Changes

- backend sdks prep

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.15.0-alpha.0

## 0.25.0

### Minor Changes

- shouldToggleHoveringEditorOnKeyPress

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.14.0

## 0.24.0

### Minor Changes

- contextCategories no longer optional for reading context

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.13.0

## 0.23.0

### Minor Changes

- fixed bug: useMakeCopilotDocumentReadable category reference

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.12.0

## 0.22.0

### Minor Changes

- add support for hoverMenuClassname

## 0.21.0

### Minor Changes

- support for custom api headers + body, fixed es5 build error on import
- 9abfea6: js import
- 2b9591a: esm.js maybe
- 2b9591a: headers and body propagation
- 2b9591a: cjs exp
- 2b9591a: treeshake
- 2b9591a: commonJS
- 222f5e6: undo alpha changes
- 2b9591a: cjs maybe

### Patch Changes

- Updated dependencies
- Updated dependencies [9abfea6]
- Updated dependencies [2b9591a]
- Updated dependencies [2b9591a]
- Updated dependencies [2b9591a]
- Updated dependencies [2b9591a]
- Updated dependencies [2b9591a]
- Updated dependencies [222f5e6]
- Updated dependencies [2b9591a]
  - @copilotkit/react-core@0.11.0

## 0.21.0-alpha.7

### Minor Changes

- js import

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.11.0-alpha.7

## 0.21.0-alpha.6

### Minor Changes

- undo alpha changes

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.11.0-alpha.6

## 0.21.0-alpha.5

### Minor Changes

- commonJS

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.11.0-alpha.5

## 0.21.0-alpha.4

### Minor Changes

- esm.js maybe

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.11.0-alpha.4

## 0.21.0-alpha.3

### Minor Changes

- cjs maybe

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.11.0-alpha.3

## 0.21.0-alpha.2

### Minor Changes

- cjs exp

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.11.0-alpha.2

## 0.21.0-alpha.1

### Minor Changes

- treeshake

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.11.0-alpha.1

## 0.21.0-alpha.0

### Minor Changes

- headers and body propagation

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.11.0-alpha.0

## 0.20.0

### Minor Changes

- document contents funneled to prompt context

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.10.0

## 0.19.1

### Patch Changes

- Updated dependencies [0467f62]
  - @copilotkit/react-core@0.9.0

## 0.19.0

### Minor Changes

- 1b330b5: out of beta: centralized api, textarea insertions/edits
- e4ce3ab: textarea edits mvp
- 9e201c5: textarea insertions deletions etc
- 7f8d531: package json
- 96f5630: react-ui missing declaration
- c13ffcb: minor bugfix
- e4fe6a5: copilot textarea documents - provide with code skeleton
- 8e9f9b1: api endpoint centralization
- 5829585: beta bump

### Patch Changes

- 12407db: rebase master
- 939454e: prettify
- Updated dependencies [1b330b5]
- Updated dependencies [e4ce3ab]
- Updated dependencies [9e201c5]
- Updated dependencies [c13ffcb]
- Updated dependencies [12407db]
- Updated dependencies [e4fe6a5]
- Updated dependencies [8e9f9b1]
- Updated dependencies [939454e]
  - @copilotkit/react-core@0.8.0

## 0.19.0-alpha.9

### Minor Changes

- copilot textarea documents - provide with code skeleton

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.8.0-alpha.6

## 0.19.0-alpha.8

### Minor Changes

- minor bugfix

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.8.0-alpha.5

## 0.19.0-alpha.7

### Minor Changes

- api endpoint centralization

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.8.0-alpha.4

## 0.19.0-alpha.6

### Minor Changes

- package json

### Patch Changes

- @copilotkit/react-core@0.8.0-alpha.3

## 0.19.0-alpha.5

### Minor Changes

- react-ui missing declaration

### Patch Changes

- @copilotkit/react-core@0.8.0-alpha.3

## 0.19.0-alpha.4

### Minor Changes

- beta bump

## 0.19.0-alpha.3

### Minor Changes

- textarea edits mvp

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.8.0-alpha.3

## 0.19.0-alpha.2

### Patch Changes

- rebase master
- Updated dependencies
  - @copilotkit/react-core@0.8.0-alpha.2

## 0.19.0-alpha.1

### Patch Changes

- prettify
- Updated dependencies
  - @copilotkit/react-core@0.8.0-alpha.1

## 0.19.0-alpha.0

### Minor Changes

- textarea insertions deletions etc

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.8.0-alpha.0

## 0.18.0

### Minor Changes

- e9624bc: fix text replacement behavior

## 0.17.0

### Minor Changes

- 6624a13: Textarea: no default apiEndpoint, textareaPurpose, css bugfix

## 0.16.0

### Minor Changes

- e182a29: copilottextarea: remove nodes conditionally with try catch

## 0.15.1

### Patch Changes

- 8f4b3d1: do not include disableBranding in props forwarded to DOM

## 0.15.0

### Minor Changes

- 3580a3c: correctly export ChatlikeApiEndpoint

## 0.14.1

### Patch Changes

- 20bed44: added custom static factory method to ChatlikeApiEndpoint

## 0.14.0

### Minor Changes

- cfdc367: export ChatlikeApiEndpoint types in original name

## 0.13.0

### Minor Changes

- 1f26798: standard CopilotTextarea apiEndpoint takes an implementation, not just a string endpoint

## 0.12.0

### Minor Changes

- ec7484f: - CopilotTextarea supports passing in ref compatible with <textarea>'s HTMLTextAreaElement ref (for focus, blur, styling, etc.)
  - Minor bug fix: CopilotTextarea branding remains correclty positioned as textarea scrolls

## 0.11.0

### Minor Changes

- 3517bd5: CopilotTextarea supports standard onChange interface

## 0.10.0

### Minor Changes

- 7ae5549: Added support for a disabled parameter on CopilotTextarea

## 0.9.0

### Minor Changes

- 59f9fc4: code quality and optional branding

## 0.8.0

### Minor Changes

- ce193f7: Dependency fix

### Patch Changes

- Updated dependencies [ce193f7]
  - @copilotkit/react-core@0.7.0

## 0.7.0

### Minor Changes

- Made CopilotTextarea standalone for clarity

## 0.6.0

### Minor Changes

- Introduced CopilotTextarea

## 0.5.0

### Minor Changes

- bring private packages back into the void
- added tsconfig and eslint-config-custom to copilotkit scope

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @copilotkit/react-core@0.5.0

## 0.4.0

### Minor Changes

- first beta release

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@0.4.0

## 0.3.0

### Minor Changes

- working version
- 9d2f3cb: semi compiling

### Patch Changes

- Updated dependencies
- Updated dependencies [9d2f3cb]
  - @copilotkit/react-core@0.3.0

## 0.2.0

### Minor Changes

- react core initialization

## 0.1.0

### Minor Changes

- initial
