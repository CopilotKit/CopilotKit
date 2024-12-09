# @copilotkit/sdk-js

## 1.4.1-pre.1

### Patch Changes

- add zod conversion
- Updated dependencies
  - @copilotkit/shared@1.4.1-pre.1

## 1.4.1-pre.0

### Patch Changes

- lower case copilotkit property
- Updated dependencies
  - @copilotkit/shared@1.4.1-pre.0

## 1.4.0

### Minor Changes

CopilotKit Core:

- Improved error messages and overall logs
- `useCopilotAction.renderAndAwait` renamed to `.renderAndAwaitForResponse` (backwards compatible, will be deprecated in the future)
- Improved scrolling behavior. It is now possible to scroll up during LLM response generation
- Added Azure OpenAI integration
- Updated interfaces for better developer ergonomics

CoAgents:

- Renamed `remoteActions` to `remoteEndpoints` (backwards compatible, will be deprecated in the future)
- Support for LangGraph Platform in Remote Endpoints
- LangGraph JS Support for CoAgents (locally via `langgraph dev`, `langgraph up` or deployed to LangGraph Platform)
- Improved LangSmith integration - requests made through CoAgents will now surface in LangSmith
- Enhanced state management and message handling

CopilotKid Back-end SDK:

- Released a whole-new `@copilotkit/sdk-js` for building agents with LangGraph JS Support

### Patch Changes

- f6fab28: update tsup config
- f6fab28: update entry
- f6fab28: export langchain module
- f6fab28: Ensure intermediate state config is sent as snake case
- f6fab28: update entry in tsup config
- a5efccd: Revert rxjs changes
- f6fab28: update entry
- f6fab28: Update exports
- f6fab28: Update exports
- f6fab28: Export LangGraph functions
- f6fab28: Update lockfile
- Updated dependencies [f6fab28]
- Updated dependencies [f6fab28]
- Updated dependencies
- Updated dependencies [f6fab28]
- Updated dependencies [8a77944]
- Updated dependencies [f6fab28]
- Updated dependencies [f6fab28]
- Updated dependencies [8a77944]
- Updated dependencies [a5efccd]
- Updated dependencies [f6fab28]
- Updated dependencies [f6fab28]
- Updated dependencies [f6fab28]
- Updated dependencies [332d744]
- Updated dependencies [f6fab28]
- Updated dependencies [f6fab28]
  - @copilotkit/shared@1.4.0

## 1.3.16-mme-revert-rxjs-changes.10

### Patch Changes

- f6fab28: update tsup config
- f6fab28: update entry
- f6fab28: export langchain module
- f6fab28: Ensure intermediate state config is sent as snake case
- f6fab28: update entry in tsup config
- Revert rxjs changes
- f6fab28: update entry
- f6fab28: Update exports
- f6fab28: Update exports
- f6fab28: Export LangGraph functions
- f6fab28: Update lockfile
- Updated dependencies [f6fab28]
- Updated dependencies [f6fab28]
- Updated dependencies [f6fab28]
- Updated dependencies [8a77944]
- Updated dependencies [f6fab28]
- Updated dependencies [f6fab28]
- Updated dependencies [8a77944]
- Updated dependencies
- Updated dependencies [f6fab28]
- Updated dependencies [f6fab28]
- Updated dependencies [f6fab28]
- Updated dependencies [332d744]
- Updated dependencies [f6fab28]
- Updated dependencies [f6fab28]
  - @copilotkit/shared@1.3.16-mme-revert-rxjs-changes.10

## 1.3.16-mme-lgc-langgraph-package.9

### Patch Changes

- update entry
- Updated dependencies
  - @copilotkit/shared@1.3.16-mme-lgc-langgraph-package.9

## 1.3.16-mme-lgc-langgraph-package.8

### Patch Changes

- update entry
- Updated dependencies
  - @copilotkit/shared@1.3.16-mme-lgc-langgraph-package.8

## 1.3.16-mme-lgc-langgraph-package.7

### Patch Changes

- update entry in tsup config
- Updated dependencies
  - @copilotkit/shared@1.3.16-mme-lgc-langgraph-package.7

## 1.3.16-mme-lgc-langgraph-package.6

### Patch Changes

- Update exports
- Updated dependencies
  - @copilotkit/shared@1.3.16-mme-lgc-langgraph-package.6

## 1.3.16-mme-lgc-langgraph-package.5

### Patch Changes

- update tsup config
- Updated dependencies
  - @copilotkit/shared@1.3.16-mme-lgc-langgraph-package.5

## 1.3.16-mme-lgc-langgraph-package.4

### Patch Changes

- Update exports
- Updated dependencies
  - @copilotkit/shared@1.3.16-mme-lgc-langgraph-package.4

## 1.3.16-mme-lgc-langgraph-package.3

### Patch Changes

- export langchain module
- Updated dependencies
  - @copilotkit/shared@1.3.16-mme-lgc-langgraph-package.3

## 1.3.16-mme-sdk-js.2

### Patch Changes

- Ensure intermediate state config is sent as snake case
- Updated dependencies
  - @copilotkit/shared@1.3.16-mme-sdk-js.2

## 1.3.16-mme-sdk-js.1

### Patch Changes

- Update lockfile
- Updated dependencies
  - @copilotkit/shared@1.3.16-mme-sdk-js.1

## 1.3.16-mme-sdk-js.0

### Patch Changes

- Export LangGraph functions
- Updated dependencies
  - @copilotkit/shared@1.3.16-mme-sdk-js.0
