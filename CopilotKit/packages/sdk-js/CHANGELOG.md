# @copilotkit/sdk-js

## 1.4.4-next.0

### Patch Changes

- @copilotkit/shared@1.4.4-next.0

## 1.4.3

### Patch Changes

- c296282: - Better error surfacing when using LangGraph Platform streaming
  - Ensure state is immediately set without using flushSync
- - Better error surfacing when using LangGraph Platform streaming
  - Ensure state is immediately set without using flushSync
- Updated dependencies [c296282]
- Updated dependencies
  - @copilotkit/shared@1.4.3

## 1.4.3-pre.0

### Patch Changes

- - Better error surfacing when using LangGraph Platform streaming
  - Ensure state is immediately set without using flushSync
- Updated dependencies
  - @copilotkit/shared@1.4.3-pre.0

## 1.4.2

### Patch Changes

- - Make sure agent state is set immediately (#1077)
  - Support running an agent without messages (#1075)
- Updated dependencies
  - @copilotkit/shared@1.4.2

## 1.4.1

### Patch Changes

- 1721cbd: lower case copilotkit property
- 1721cbd: add zod conversion
- 8d0144f: bump
- 8d0144f: bump
- 8d0144f: bump
- e16d95e: New prerelease
- 1721cbd: Add convertActionsToDynamicStructuredTools to sdk-js
- CopilotKit Core:

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

- 8d0144f: bump
- 8d0144f: bump
- fef1b74: fix assistant message CSS and propagate actions to LG JS
- Updated dependencies [1721cbd]
- Updated dependencies [1721cbd]
- Updated dependencies [8d0144f]
- Updated dependencies [8d0144f]
- Updated dependencies [8d0144f]
- Updated dependencies [e16d95e]
- Updated dependencies [1721cbd]
- Updated dependencies
- Updated dependencies [8d0144f]
- Updated dependencies [8d0144f]
- Updated dependencies [fef1b74]
  - @copilotkit/shared@1.4.1

## 1.4.1-pre.6

### Patch Changes

- 1721cbd: lower case copilotkit property
- 1721cbd: add zod conversion
- 1721cbd: Add convertActionsToDynamicStructuredTools to sdk-js
- fix assistant message CSS and propagate actions to LG JS
- Updated dependencies [1721cbd]
- Updated dependencies [1721cbd]
- Updated dependencies [1721cbd]
- Updated dependencies
  - @copilotkit/shared@1.4.1-pre.6

## 1.4.1-pre.5

### Patch Changes

- bump
- Updated dependencies
  - @copilotkit/shared@1.4.1-pre.5

## 1.4.1-pre.4

### Patch Changes

- bump
- Updated dependencies
  - @copilotkit/shared@1.4.1-pre.4

## 1.4.1-pre.3

### Patch Changes

- bump
- Updated dependencies
  - @copilotkit/shared@1.4.1-pre.3

## 1.4.1-pre.2

### Patch Changes

- bump
- Updated dependencies
  - @copilotkit/shared@1.4.1-pre.2

## 1.4.1-pre.1

### Patch Changes

- bump
- Updated dependencies
  - @copilotkit/shared@1.4.1-pre.1

## 1.4.1-pre.0

### Patch Changes

- New prerelease
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
