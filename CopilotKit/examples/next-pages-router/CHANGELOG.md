# next-pages-router

## 1.3.11

### Patch Changes

- 08e8956: Fix duplicate messages
- Fix duplicate messages
- Updated dependencies [08e8956]
- Updated dependencies
  - @copilotkit/runtime@1.3.11
  - @copilotkit/react-core@1.3.11
  - @copilotkit/react-textarea@1.3.11
  - @copilotkit/react-ui@1.3.11
  - @copilotkit/shared@1.3.11

## 1.3.11-mme-fix-duplicate-messages.0

### Patch Changes

- Fix duplicate messages
- Updated dependencies
  - @copilotkit/runtime@1.3.11-mme-fix-duplicate-messages.0
  - @copilotkit/react-core@1.3.11-mme-fix-duplicate-messages.0
  - @copilotkit/react-textarea@1.3.11-mme-fix-duplicate-messages.0
  - @copilotkit/react-ui@1.3.11-mme-fix-duplicate-messages.0
  - @copilotkit/shared@1.3.11-mme-fix-duplicate-messages.0

## 1.3.10

### Patch Changes

- change how message chunk type is resolved (fixed langchain adapters)
- Updated dependencies
  - @copilotkit/react-core@1.3.10
  - @copilotkit/react-textarea@1.3.10
  - @copilotkit/react-ui@1.3.10
  - @copilotkit/runtime@1.3.10
  - @copilotkit/shared@1.3.10

## 1.3.9

### Patch Changes

- Fix message id issues
- Updated dependencies
  - @copilotkit/react-core@1.3.9
  - @copilotkit/react-textarea@1.3.9
  - @copilotkit/react-ui@1.3.9
  - @copilotkit/runtime@1.3.9
  - @copilotkit/shared@1.3.9

## 1.3.8

### Patch Changes

- fix textarea on multiple llm providers and memoize react ui context
- Updated dependencies
  - @copilotkit/react-core@1.3.8
  - @copilotkit/react-textarea@1.3.8
  - @copilotkit/react-ui@1.3.8
  - @copilotkit/runtime@1.3.8
  - @copilotkit/shared@1.3.8

## 1.3.7

### Patch Changes

- Fix libraries for React 19 and Next.js 15 support
- Updated dependencies
  - @copilotkit/react-core@1.3.7
  - @copilotkit/react-textarea@1.3.7
  - @copilotkit/react-ui@1.3.7
  - @copilotkit/runtime@1.3.7
  - @copilotkit/shared@1.3.7

## 1.3.6

### Patch Changes

- 1. Removes the usage of the `crypto` Node pacakge, instaed uses `uuid`. This ensures that non-Next.js React apps can use CopilotKit.
  2. Fixes Nest.js runtime docs

- Updated dependencies
  - @copilotkit/react-core@1.3.6
  - @copilotkit/react-textarea@1.3.6
  - @copilotkit/react-ui@1.3.6
  - @copilotkit/runtime@1.3.6
  - @copilotkit/shared@1.3.6

## 1.3.5

### Patch Changes

- Improve CoAgent state render
- Updated dependencies
  - @copilotkit/react-core@1.3.5
  - @copilotkit/react-textarea@1.3.5
  - @copilotkit/react-ui@1.3.5
  - @copilotkit/runtime@1.3.5
  - @copilotkit/shared@1.3.5

## 1.3.4

### Patch Changes

- Add followUp property to useCopilotAction
- Updated dependencies
  - @copilotkit/react-core@1.3.4
  - @copilotkit/react-textarea@1.3.4
  - @copilotkit/react-ui@1.3.4
  - @copilotkit/runtime@1.3.4
  - @copilotkit/shared@1.3.4

## 1.3.3

### Patch Changes

- Impvovements to error handling and CoAgent protocol
- Updated dependencies
  - @copilotkit/react-core@1.3.3
  - @copilotkit/react-textarea@1.3.3
  - @copilotkit/react-ui@1.3.3
  - @copilotkit/runtime@1.3.3
  - @copilotkit/shared@1.3.3

## 1.3.2

### Patch Changes

- Features and bug fixes
- 30232c0: Ensure actions can be discovered on state change
- Updated dependencies
- Updated dependencies [30232c0]
  - @copilotkit/react-core@1.3.2
  - @copilotkit/react-textarea@1.3.2
  - @copilotkit/react-ui@1.3.2
  - @copilotkit/runtime@1.3.2
  - @copilotkit/shared@1.3.2

## 1.3.2-mme-discover-actions.0

### Patch Changes

- Ensure actions can be discovered on state change
- Updated dependencies
  - @copilotkit/react-core@1.3.2-mme-discover-actions.0
  - @copilotkit/react-textarea@1.3.2-mme-discover-actions.0
  - @copilotkit/react-ui@1.3.2-mme-discover-actions.0
  - @copilotkit/runtime@1.3.2-mme-discover-actions.0
  - @copilotkit/shared@1.3.2-mme-discover-actions.0

## 1.3.1

### Patch Changes

- Revert CSS injection
- Updated dependencies
  - @copilotkit/react-core@1.3.1
  - @copilotkit/react-textarea@1.3.1
  - @copilotkit/react-ui@1.3.1
  - @copilotkit/runtime@1.3.1
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
  - @copilotkit/react-textarea@1.3.0
  - @copilotkit/react-ui@1.3.0
  - @copilotkit/runtime@1.3.0
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
  - @copilotkit/react-textarea@1.2.1
  - @copilotkit/react-ui@1.2.1
  - @copilotkit/runtime@1.2.1
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
  - @copilotkit/react-textarea@1.2.0
  - @copilotkit/react-ui@1.2.0
  - @copilotkit/runtime@1.2.0
  - @copilotkit/shared@1.2.0

## 1.1.2

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@1.1.2
  - @copilotkit/react-textarea@1.1.2
  - @copilotkit/react-ui@1.1.2
  - @copilotkit/runtime@1.1.2
  - @copilotkit/shared@1.1.2

## 1.1.1

### Patch Changes

- - improved documentation
  - center textarea popup
  - show/hide dev console
  - forward maxTokens, stop and force function calling
- Updated dependencies
  - @copilotkit/react-core@1.1.1
  - @copilotkit/react-textarea@1.1.1
  - @copilotkit/react-ui@1.1.1
  - @copilotkit/runtime@1.1.1
  - @copilotkit/shared@1.1.1

## 1.1.0

### Minor Changes

- Official support for Groq (`GroqAdapter`)

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@1.1.0
  - @copilotkit/react-textarea@1.1.0
  - @copilotkit/react-ui@1.1.0
  - @copilotkit/runtime@1.1.0
  - @copilotkit/shared@1.1.0

## 1.0.9

### Patch Changes

- Dev console, bugfixes
- Updated dependencies
  - @copilotkit/react-core@1.0.9
  - @copilotkit/react-textarea@1.0.9
  - @copilotkit/react-ui@1.0.9
  - @copilotkit/runtime@1.0.9
  - @copilotkit/shared@1.0.9

## 1.0.8

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@1.0.8
  - @copilotkit/react-textarea@1.0.8
  - @copilotkit/react-ui@1.0.8
  - @copilotkit/runtime@1.0.8
  - @copilotkit/shared@1.0.8

## 1.0.7

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@1.0.7
  - @copilotkit/react-textarea@1.0.7
  - @copilotkit/react-ui@1.0.7
  - @copilotkit/runtime@1.0.7
  - @copilotkit/shared@1.0.7

## 1.0.6

### Patch Changes

- - Proactively prevent race conditions
  - Improve token counting performance
- Updated dependencies
  - @copilotkit/react-core@1.0.6
  - @copilotkit/react-textarea@1.0.6
  - @copilotkit/react-ui@1.0.6
  - @copilotkit/runtime@1.0.6
  - @copilotkit/shared@1.0.6

## 1.0.5

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@1.0.5
  - @copilotkit/react-textarea@1.0.5
  - @copilotkit/react-ui@1.0.5
  - @copilotkit/runtime@1.0.5
  - @copilotkit/shared@1.0.5

## 1.0.4

### Patch Changes

- Remove nanoid
- Updated dependencies
  - @copilotkit/react-core@1.0.4
  - @copilotkit/react-textarea@1.0.4
  - @copilotkit/react-ui@1.0.4
  - @copilotkit/runtime@1.0.4
  - @copilotkit/shared@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@1.0.3
  - @copilotkit/react-textarea@1.0.3
  - @copilotkit/react-ui@1.0.3
  - @copilotkit/runtime@1.0.3
  - @copilotkit/shared@1.0.3

## 1.0.2

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@1.0.2
  - @copilotkit/react-textarea@1.0.2
  - @copilotkit/react-ui@1.0.2
  - @copilotkit/runtime@1.0.2
  - @copilotkit/shared@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies
  - @copilotkit/react-core@1.0.1
  - @copilotkit/react-textarea@1.0.1
  - @copilotkit/react-ui@1.0.1
  - @copilotkit/runtime@1.0.1
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

- Updated dependencies [b6a4b6eb]
- Updated dependencies [b6a4b6eb]
- Updated dependencies [b6a4b6eb]
- Updated dependencies
  - @copilotkit/react-core@1.0.0
  - @copilotkit/react-textarea@1.0.0
  - @copilotkit/react-ui@1.0.0
  - @copilotkit/runtime@1.0.0
  - @copilotkit/shared@1.0.0

## 1.0.0-beta.2

### Patch Changes

- Updated dependencies
  - @copilotkit/react-textarea@1.0.0-beta.2
  - @copilotkit/react-core@1.0.0-beta.2
  - @copilotkit/react-ui@1.0.0-beta.2
  - @copilotkit/runtime@1.0.0-beta.2
  - @copilotkit/shared@1.0.0-beta.2

## 1.0.0-beta.1

### Patch Changes

- Updated dependencies
  - @copilotkit/react-textarea@1.0.0-beta.1
  - @copilotkit/react-core@1.0.0-beta.1
  - @copilotkit/react-ui@1.0.0-beta.1
  - @copilotkit/runtime@1.0.0-beta.1
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
  - @copilotkit/react-textarea@1.0.0-beta.0
  - @copilotkit/react-ui@1.0.0-beta.0
  - @copilotkit/runtime@1.0.0-beta.0
  - @copilotkit/shared@1.0.0-beta.0
