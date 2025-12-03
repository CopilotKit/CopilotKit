# @copilotkit/shared

## 1.10.7-next.0

## 1.10.6

### Patch Changes

- e0dd5d5: - feat: allow additional config in direct to llm actions

## 1.10.6-next.6

## 1.10.6-next.5

### Patch Changes

- e0dd5d5: - feat: allow additional config in direct to llm actions

## 1.10.6-next.4

## 1.10.6-next.3

## 1.10.6-next.2

## 1.10.6-next.1

## 1.10.6-next.0

## 1.10.5

## 1.10.5-next.10

## 1.10.5-next.9

## 1.10.5-next.8

## 1.10.5-next.7

## 1.10.5-next.6

## 1.10.5-next.5

## 1.10.5-next.4

## 1.10.5-next.3

## 1.10.5-next.2

## 1.10.5-next.1

## 1.10.5-next.0

## 1.10.4

### Patch Changes

- a640d8e: - feat: update latest agui langgraph for subgraphs support
  - feat: update latest agui core packages

## 1.10.4-next.3

## 1.10.4-next.2

## 1.10.4-next.1

### Patch Changes

- a640d8e: - feat: update latest agui langgraph for subgraphs support
  - feat: update latest agui core packages

## 1.10.4-next.0

## 1.10.3

### Patch Changes

- ea74047: - fix: surface run errors from agui

## 1.10.3-next.3

## 1.10.3-next.2

## 1.10.3-next.1

## 1.10.3-next.0

### Patch Changes

- ea74047: - fix: surface run errors from agui

## 1.10.2

## 1.10.2-next.0

## 1.10.1

## 1.10.1-next.2

## 1.10.1-next.1

## 1.10.1-next.0

## 1.10.0

### Minor Changes

- 8674da1: - refactor(headless): completely overhaul headless ui to better support agentic features

  Headless UI has been in a bad state for a bit now. When we added support for different
  agentic runtimes we acquired tech-debt that, with this PR, is being alleviated.

  As such, the following features have been updated to be completely functional with Headless UI.

  - Generative UI
  - Suggestions
  - Agentic Generative UI
  - Interrupts

  In addition, a variety of QOL changes have been made.

  - New AG-UI based message types
  - Inline code rendering is fixed

  Signed-off-by: Tyler Slaton <tyler@copilotkit.ai>

### Patch Changes

- a8c0263: - feat: add event hooks system for chat components
- 6d1de58: - fix: address issues that would cause headless UI breaking changes in the next release

  Signed-off-by: Tyler Slaton <tyler@copilotkit.ai>

  - fix: more fixes addressing breaking changes in new Headless UI

  Signed-off-by: Tyler Slaton <tyler@copilotkit.ai>

  - chore: address linting issues

  Signed-off-by: Tyler Slaton <tyler@copilotkit.ai>

  - chore: fixing branding and docs

  Signed-off-by: Tyler Slaton <tyler@copilotkit.ai>

  - chore: more docs fixing

  Signed-off-by: Tyler Slaton <tyler@copilotkit.ai>

## 1.10.0-next.13

## 1.10.0-next.12

## 1.10.0-next.11

## 1.10.0-next.10

### Patch Changes

- 6d1de58: - fix: address issues that would cause headless UI breaking changes in the next release

  Signed-off-by: Tyler Slaton <tyler@copilotkit.ai>

  - fix: more fixes addressing breaking changes in new Headless UI

  Signed-off-by: Tyler Slaton <tyler@copilotkit.ai>

  - chore: address linting issues

  Signed-off-by: Tyler Slaton <tyler@copilotkit.ai>

  - chore: fixing branding and docs

  Signed-off-by: Tyler Slaton <tyler@copilotkit.ai>

  - chore: more docs fixing

  Signed-off-by: Tyler Slaton <tyler@copilotkit.ai>

## 1.10.0-next.9

## 1.10.0-next.8

## 1.10.0-next.7

## 1.10.0-next.6

## 1.10.0-next.5

### Patch Changes

- a8c0263: - feat: add event hooks system for chat components

## 1.10.0-next.4

## 1.10.0-next.3

## 1.10.0-next.2

## 1.10.0-next.1

## 1.10.0-next.0

### Minor Changes

- 8674da1: - refactor(headless): completely overhaul headless ui to better support agentic features

  Headless UI has been in a bad state for a bit now. When we added support for different
  agentic runtimes we acquired tech-debt that, with this PR, is being alleviated.

  As such, the following features have been updated to be completely functional with Headless UI.

  - Generative UI
  - Suggestions
  - Agentic Generative UI
  - Interrupts

  In addition, a variety of QOL changes have been made.

  - New AG-UI based message types
  - Inline code rendering is fixed

  Signed-off-by: Tyler Slaton <tyler@copilotkit.ai>

## 1.9.3

### Patch Changes

- 1bda332: - chore(telemetry): integrate Scarf for usage analytics

## 1.9.3-next.4

## 1.9.3-next.3

### Patch Changes

- 1bda332: - chore(telemetry): integrate Scarf for usage analytics

## 1.9.3-next.2

## 1.9.3-next.1

## 1.9.3-next.0

## 1.9.2

### Patch Changes

- fac89c2: - refactor: rename onTrace to onError throughout codebase

  - Rename CopilotTraceEvent to CopilotErrorEvent and CopilotTraceHandler to CopilotErrorHandler

- 9169ad7: - feat: add onTrace handler for runtime and UI error/event tracking
- 1d1c51d: - feat: surface all errors in structured format
- 10345a5: - feat: structured error visibility system for streaming errors
- 9169ad7: - feat: add onTrace handler for comprehensive debugging and observability - Add CopilotTraceEvent interfaces with rich debugging context, implement runtime-side tracing with publicApiKey gating, add UI-side error tracing, include comprehensive test coverage, and fix tsup build config to exclude test files
  - fix: extract publicApiKey for all requests + trace GraphQL errors

## 1.9.2-next.26

## 1.9.2-next.25

## 1.9.2-next.24

## 1.9.2-next.23

## 1.9.2-next.22

## 1.9.2-next.21

## 1.9.2-next.20

## 1.9.2-next.19

## 1.9.2-next.18

### Patch Changes

- fac89c2: - refactor: rename onTrace to onError throughout codebase

  - Rename CopilotTraceEvent to CopilotErrorEvent and CopilotTraceHandler to CopilotErrorHandler

## 1.9.2-next.17

## 1.9.2-next.16

## 1.9.2-next.15

## 1.9.2-next.14

## 1.9.2-next.13

## 1.9.2-next.12

## 1.9.2-next.11

## 1.9.2-next.10

## 1.9.2-next.9

### Patch Changes

- 1d1c51d: - feat: surface all errors in structured format

## 1.9.2-next.8

## 1.9.2-next.7

## 1.9.2-next.6

## 1.9.2-next.5

## 1.9.2-next.4

### Patch Changes

- 9169ad7: - feat: add onTrace handler for runtime and UI error/event tracking
- 9169ad7: - feat: add onTrace handler for comprehensive debugging and observability - Add CopilotTraceEvent interfaces with rich debugging context, implement runtime-side tracing with publicApiKey gating, add UI-side error tracing, include comprehensive test coverage, and fix tsup build config to exclude test files
  - fix: extract publicApiKey for all requests + trace GraphQL errors

## 1.9.2-next.3

## 1.9.2-next.2

## 1.9.2-next.1

## 1.9.2-next.0

### Patch Changes

- 10345a5: - feat: structured error visibility system for streaming errors

## 1.9.1

### Patch Changes

- deaeca0: - feat: Add public key

  Signed-off-by: Luis Valdes <luis@copilotkit.ai>

## 1.9.1-next.0

### Patch Changes

- deaeca0: - feat: Add public key

  Signed-off-by: Luis Valdes <luis@copilotkit.ai>

## 1.9.0

## 1.9.0-next.2

## 1.8.15-next.1

## 1.8.15-next.0

## 1.8.14

### Patch Changes

- 34a78d8: - jsonSchemaToActionParameters implementation

## 1.8.14-next.5

## 1.8.14-next.4

## 1.8.14-next.3

## 1.8.14-next.2

## 1.8.14-next.1

### Patch Changes

- 34a78d8: - jsonSchemaToActionParameters implementation

## 1.8.14-next.0

## 1.8.13

## 1.8.13-next.3

## 1.8.13-next.2

## 1.8.13-next.1

## 1.8.13-next.0

## 1.8.12

## 1.8.12-next.6

## 1.8.12-next.5

## 1.8.12-next.4

## 1.8.12-next.3

## 1.8.12-next.2

## 1.8.12-next.1

## 1.8.12-next.0

## 1.8.11

## 1.8.11-next.1

## 1.8.11-next.0

## 1.8.10

## 1.8.10-next.3

## 1.8.10-next.2

## 1.8.10-next.1

## 1.8.10-next.0

## 1.8.9

## 1.8.9-next.0

## 1.8.8

## 1.8.8-next.1

## 1.8.8-next.0

## 1.8.7

## 1.8.7-next.0

## 1.8.6

## 1.8.6-next.0

## 1.8.5

## 1.8.5-next.5

## 1.8.5-next.4

## 1.8.5-next.3

## 1.8.5-next.2

## 1.8.5-next.1

## 1.8.5-next.0

## 1.8.4

### Patch Changes

- f363760: - fix: when unable to find specified agent, show what's available

## 1.8.4-next.4

## 1.8.4-next.3

## 1.8.4-next.2

## 1.8.4-next.1

### Patch Changes

- f363760: - fix: when unable to find specified agent, show what's available

## 1.8.4-next.0

## 1.8.3

## 1.8.3-next.0

## 1.8.2-next.3

## 1.8.2-next.2

## 1.8.2-next.1

## 1.8.2-next.0

## 1.8.1

## 1.8.1-next.1

## 1.8.1-next.0

## 1.8.0

## 1.8.0-next.8

## 1.8.0-next.7

## 1.8.0-next.6

## 1.8.0-next.5

## 1.8.0-next.4

## 1.8.0-next.3

## 1.7.2-next.2

## 1.7.2-next.1

## 1.7.2-next.0

## 1.7.1

## 1.7.1-next.0

## 1.7.0

## 1.7.0-next.1

## 1.7.0-next.0

## 1.6.0

### Patch Changes

- 090203d: - fix: use tryMap method to filter out possibly invalid items

## 1.6.0-next.12

## 1.6.0-next.11

## 1.6.0-next.10

## 1.6.0-next.9

## 1.6.0-next.8

## 1.6.0-next.7

## 1.6.0-next.6

## 1.6.0-next.5

### Patch Changes

- 090203d: - fix: use tryMap method to filter out possibly invalid items

## 1.6.0-next.4

## 1.6.0-next.3

## 1.6.0-next.2

## 1.6.0-next.1

## 1.6.0-next.0

## 1.5.20

### Patch Changes

- 51f0d66: - fix(errors): fix internal usage of error resolver

## 1.5.20-next.0

### Patch Changes

- 51f0d66: - fix(errors): fix internal usage of error resolver

## 1.5.19

### Patch Changes

- 0dd1ab9: - fix(errors): allow non copilotkit errors to pass to consumer app error boundary

## 1.5.19-next.1

### Patch Changes

- 0dd1ab9: - fix(errors): allow non copilotkit errors to pass to consumer app error boundary

## 1.5.19-next.0

## 1.5.18

### Patch Changes

- d47cd26: - fix: detect and alert on version mismatch
- f77a7b9: - fix: use warning when version mismatch is not expected to error out
- 38d3ac2: - fix: add additional info the our error messages

## 1.5.18-next.3

### Patch Changes

- f77a7b9: - fix: use warning when version mismatch is not expected to error out

## 1.5.18-next.2

### Patch Changes

- 38d3ac2: - fix: add additional info the our error messages

## 1.5.18-next.1

## 1.5.18-next.0

### Patch Changes

- d47cd26: - fix: detect and alert on version mismatch

## 1.5.17

### Patch Changes

- 1fc3902: - Revert "fix: detect and alert on version mismatch (#1333)"

  This reverts commit 48b7c7b1bd48ced82ffb9a00d6eddc1f7581e0c1.

## 1.5.17-next.0

### Patch Changes

- 1fc3902: - Revert "fix: detect and alert on version mismatch (#1333)"

  This reverts commit 48b7c7b1bd48ced82ffb9a00d6eddc1f7581e0c1.

## 1.5.16

### Patch Changes

- 48b7c7b: - fix: detect and alert on version mismatch

## 1.5.16-next.2

## 1.5.16-next.1

### Patch Changes

- 48b7c7b: - fix: detect and alert on version mismatch

## 1.5.16-next.0

## 1.5.15

### Patch Changes

- 7b3141d: - feat(interrupt): support LG interrupt with useLangGraphInterrupt hook
  - chore(interrupt): add e2e test to interrupt functionality
  - feat(interrupt): add support for multiple interrupts and conditions

## 1.5.15-next.8

## 1.5.15-next.7

## 1.5.15-next.6

## 1.5.15-next.5

## 1.5.15-next.4

### Patch Changes

- 7b3141d: - feat(interrupt): support LG interrupt with useLangGraphInterrupt hook
  - chore(interrupt): add e2e test to interrupt functionality
  - feat(interrupt): add support for multiple interrupts and conditions

## 1.5.15-next.3

## 1.5.15-next.2

## 1.5.15-next.1

## 1.5.15-next.0

## 1.5.14

### Patch Changes

- 0061f65: - feat: allows dev mode for cloud onboarding flow

## 1.5.14-next.0

### Patch Changes

- 0061f65: - feat: allows dev mode for cloud onboarding flow

## 1.5.13

## 1.5.13-next.0

## 1.5.12

### Patch Changes

- 6136a57: - fix(errors): add custom error classes to better describe library errors
  - fix(errors): use new errors in error handling
  - chore: add documentation and links to respective errors

## 1.5.12-next.7

## 1.5.12-next.6

### Patch Changes

- 6136a57: - fix(errors): add custom error classes to better describe library errors
  - fix(errors): use new errors in error handling
  - chore: add documentation and links to respective errors

## 1.5.12-next.5

## 1.5.12-next.4

## 1.5.12-next.3

## 1.5.12-next.2

## 1.5.12-next.1

## 1.5.12-next.0

## 1.5.11

## 1.5.11-next.0

## 1.5.10

## 1.5.10-next.0

## 1.5.9

## 1.5.8

## 1.5.6-next.0

## 1.5.5-next.5

## 1.5.5-next.3

## 1.5.5-next.2

## 1.5.4

## 1.5.3

## 1.5.2

## 1.5.1

### Patch Changes

- 5c01e9e: test prerelease #4
- da280ed: Test prerelease script
- 27e42d7: testing a prerelease
- 05240a9: test pre #2
- 33218fe: test prerelease #3
- 03f3d6f: Test next prerelease

## 1.5.1-next.3

### Patch Changes

- 33218fe: test prerelease #3

## 1.5.1-next.2

### Patch Changes

- da280ed: Test prerelease script

## 1.5.1-next.1

### Patch Changes

- 03f3d6f: Test next prerelease

## 1.5.1-next.0

### Patch Changes

- 27e42d7: testing a prerelease

## 1.5.0

### Minor Changes

- 1b47092: Synchronize LangGraph messages with CopilotKit

### Patch Changes

- 1b47092: CoAgents v0.3 prerelease

## 1.5.0-coagents-v0-3.0

### Minor Changes

- Synchronize LangGraph messages with CopilotKit

### Patch Changes

- e66bce4: CoAgents v0.3 prerelease

## 1.4.8

### Patch Changes

- - Better error handling
  - Introduce new "EmptyLLMAdapter" for when using CoAgents
  - Improve dev console help options
  - Allow CopilotKit remote endpoint without agents

## 1.4.8-next.0

## 1.4.7

### Patch Changes

- Fix broken build script before release

## 1.4.6

### Patch Changes

- .

## 1.4.5

### Patch Changes

- testing release workflow

## 1.4.5-next.0

### Patch Changes

- testing release workflow

## 1.4.4

## 1.4.4-next.4

## 1.4.4-next.3

## 1.4.4-next.2

## 1.4.4-next.1

## 1.4.4-next.0

## 1.4.3

### Patch Changes

- c296282: - Better error surfacing when using LangGraph Platform streaming
  - Ensure state is immediately set without using flushSync
- - Better error surfacing when using LangGraph Platform streaming
  - Ensure state is immediately set without using flushSync

## 1.4.3-pre.0

### Patch Changes

- - Better error surfacing when using LangGraph Platform streaming
  - Ensure state is immediately set without using flushSync

## 1.4.2

### Patch Changes

- - Make sure agent state is set immediately (#1077)
  - Support running an agent without messages (#1075)

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

## 1.4.1-pre.6

### Patch Changes

- 1721cbd: lower case copilotkit property
- 1721cbd: add zod conversion
- 1721cbd: Add convertActionsToDynamicStructuredTools to sdk-js
- fix assistant message CSS and propagate actions to LG JS

## 1.4.1-pre.5

### Patch Changes

- bump

## 1.4.1-pre.4

### Patch Changes

- bump

## 1.4.1-pre.3

### Patch Changes

- bump

## 1.4.1-pre.2

### Patch Changes

- bump

## 1.4.1-pre.1

### Patch Changes

- bump

## 1.4.1-pre.0

### Patch Changes

- New prerelease

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
- 8a77944: Improve LangSmith support
- f6fab28: Ensure intermediate state config is sent as snake case
- f6fab28: update entry in tsup config
- 8a77944: Ensure the last message is sent to LangSmith
- a5efccd: Revert rxjs changes
- f6fab28: update entry
- f6fab28: Update exports
- f6fab28: Update exports
- 332d744: Add support for Azure OpenAI
- f6fab28: Export LangGraph functions
- f6fab28: Update lockfile

## 1.3.16-mme-revert-rxjs-changes.10

### Patch Changes

- f6fab28: update tsup config
- f6fab28: update entry
- f6fab28: export langchain module
- 8a77944: Improve LangSmith support
- f6fab28: Ensure intermediate state config is sent as snake case
- f6fab28: update entry in tsup config
- 8a77944: Ensure the last message is sent to LangSmith
- Revert rxjs changes
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

## 1.1.2

### Patch Changes

- Pin headless-ui/react version to v2.1.1

## 1.1.1

### Patch Changes

- - improved documentation
  - center textarea popup
  - show/hide dev console
  - forward maxTokens, stop and force function calling

## 1.1.0

### Minor Changes

- Official support for Groq (`GroqAdapter`)

## 1.0.9

### Patch Changes

- Dev console, bugfixes

## 1.0.8

### Patch Changes

- Remove redundant console logs

## 1.0.7

### Patch Changes

- Add \_copilotkit internal properties to runtime

## 1.0.6

### Patch Changes

- - Proactively prevent race conditions
  - Improve token counting performance

## 1.0.5

### Patch Changes

- Include @copilotkit/runtime-client-gql NPM package version in request to Runtime

## 1.0.4

### Patch Changes

- Remove nanoid

## 1.0.3

### Patch Changes

- Add README.md to published packages and add keywords to package.json

## 1.0.2

### Patch Changes

- Add README.md and homepage/url to published packages

## 1.0.1

### Patch Changes

- Remove PostHog, use Segment Anonymous Telemetry instead

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

## 1.0.0-beta.2

### Patch Changes

- Set default Copilot Cloud runtime URL to versioned URL (v1)

## 1.0.0-beta.1

### Patch Changes

- Introduce anonymous telemetry

## 1.0.0-beta.0

### Major Changes

- V1.0 Release Candidate

  - A robust new protocol between the frontend and the Copilot Runtime
  - Support for Copilot Cloud
  - Generative UI
  - Support for LangChain universal tool calling
  - OpenAI assistant API streaming

## 0.37.0

### Minor Changes

- f771353: Fix: Stale CopilotReadable
- 9df8d43: Remove unneeded tailwind components
- CSS improvements, useCopilotChat, invisible messages

## 0.37.0-mme-fix-textarea-css.1

### Minor Changes

- Remove unneeded tailwind components

## 0.37.0-mme-fix-feedback-readable.0

### Minor Changes

- Fix: Stale CopilotReadable

## 0.36.0

### Minor Changes

- 8baa862: Add push to talk prototype
- chat suggestions, standalone chat component, gemini adapter, push to talk

## 0.36.0-mme-push-to-talk.0

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

## 0.1.1

### Patch Changes

- stop generating button working
- aa6bc5a: fix stop generate
- cf0bde6: change order of operations on stop cleanup

## 0.1.1-alpha.1

### Patch Changes

- change order of operations on stop cleanup

## 0.1.1-alpha.0

### Patch Changes

- fix stop generate

## 0.1.0

### Minor Changes

- 8a5cecd: only forward functions if non-empty
- 87f1fa0: rebase
- 15d4afc: debugging
- c40a0d1: Filter out empty function descriptions
- prep for chat protocol v2
- bbd152e: backend sdks prep
- 8517bb1: trying again
- 478840a: carry function propagation fix to chat v2

## 0.1.0-alpha.6

### Minor Changes

- rebase

## 0.1.0-alpha.5

### Minor Changes

- carry function propagation fix to chat v2

## 0.1.0-alpha.4

### Minor Changes

- only forward functions if non-empty

## 0.1.0-alpha.3

### Minor Changes

- debugging

## 0.1.0-alpha.2

### Minor Changes

- trying again

## 0.1.0-alpha.1

### Minor Changes

- Filter out empty function descriptions

## 0.1.0-alpha.0

### Minor Changes

- backend sdks prep
