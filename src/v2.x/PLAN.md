Title: Make useAgent always return a runtime agent (or throw after sync)

Goal
- Change `packages/react/src/hooks/use-agent.tsx` so it never returns `undefined`.
- While the runtime is not yet synced, return a provisional `ProxiedCopilotRuntimeAgent` instance.
- After the runtime has synced (Connected or Error), if the agent id does not exist, throw a descriptive error.
- Do not change core (`@copilotkitnext/core`) behavior so existing core tests continue to pass.

Non-Goals
- Do not change `CopilotKitCore.getAgent` semantics (it may still return `undefined` while syncing).
- Do not change Angular APIs.

Design Overview
- Implement the new behavior entirely in the React hook. Keep the core’s registry logic intact to avoid breaking current unit tests that depend on `getAgent(...)` returning `undefined` before runtime sync.
- The hook’s return type becomes `{ agent: AbstractAgent }` (non-optional). In runtime-enabled scenarios, the actual instance is a `ProxiedCopilotRuntimeAgent` while syncing, and then the real agent object once the runtime is connected.
- Only throw when “synced but missing”: runtime status is `Connected` or `Error`, and `copilotkit.getAgent(agentId)` is still `undefined`.

Implementation Plan
1) Update hook signature and behavior
   - File: `packages/react/src/hooks/use-agent.tsx`
   - Change the return type to always include an `agent: AbstractAgent` (no `undefined`).
   - Import `ProxiedCopilotRuntimeAgent` from `@copilotkitnext/core`.
   - Compute `agent` as follows:
     - Call `copilotkit.getAgent(agentId)`.
     - If it returns an agent, use it.
     - Else if `copilotkit.runtimeUrl` is defined and `runtimeConnectionStatus` is `Disconnected` or `Connecting`, construct a provisional `ProxiedCopilotRuntimeAgent`:
       - Use `runtimeUrl` and `runtimeTransport` (respect `single` or `rest`).
       - Set `agentId` and apply `copilotkit.headers`.
       - Memoize identity via `useMemo` on `(agentId, runtimeUrl, runtimeTransport, headers)`.
       - Subscribe to it with the same update handlers the hook already registers.
       - Return it.
     - Else (no runtimeUrl or runtime has already synced), throw an Error that includes: `agentId`, `runtimeUrl` (if any), and a hint to verify `/info` on the runtime.
   - Ensure the effect cleanup unsubscribes from the provisional agent subscription when the real agent becomes available.

2) Maintain SSR safety
   - `AgentRegistry.updateRuntimeConnection` early-returns when `window` is undefined; we will still return a provisional agent in SSR if `runtimeUrl` is provided, but it will not perform any network I/O until `run`/`connect` is called. This keeps SSR safe and predictable.

3) Type and dependency updates
   - Update the hook type export if necessary: `packages/react/src/hooks/index.ts` remains the same export surface; only the return type changes.
   - No change to other hooks that call `copilotkit.getAgent` directly (they may continue to receive `undefined` and should keep their current guards).

4) Documentation
   - File: `docs/REACT_API.md`
   - Update the `useAgent` section to reflect the new behavior:
     - It never returns `undefined`.
     - While syncing to a runtime, it returns a provisional `ProxiedCopilotRuntimeAgent` that is safe to use.
     - If the runtime has synced and the agent does not exist, it throws.
   - Also remove outdated mention of `isRunning` from the `useAgent` return shape (current code does not return it).

5) Tests (ensure all existing tests still pass and add new coverage)
   - Keep core tests untouched (they rely on current `getAgent` semantics):
     - `packages/core/src/__tests__/core-headers.test.ts`
     - `packages/core/src/__tests__/core-agent-id-validation.test.ts`
     - `packages/core/src/__tests__/proxied-runtime-transport.test.ts`
     - These expect `core.getAgent("remote")` to be `undefined` before runtime info is fetched and defined afterwards. We are not changing core behavior.
   - Add new React hook tests to cover the new behavior:
     - New file: `packages/react/src/hooks/__tests__/use-agent.behavior.test.tsx`
     - Cases:
       1. With `runtimeUrl` set and `window` undefined (SSR-like), `useAgent` returns a `ProxiedCopilotRuntimeAgent` while status is effectively pre-sync. Should not throw.
       2. With `runtimeUrl` set and `window` defined; mock `fetch` to return `{ agents: {}, version: "x" }`. After runtime connects (status `Connected`), `useAgent` with a non-existent `agentId` throws.
       3. With `runtimeUrl` set and remote agent present in `/info`, after connection `useAgent` returns the real remote agent instance (instanceof `ProxiedCopilotRuntimeAgent`).
       4. With no `runtimeUrl` and a local agent provided via `agents__unsafe_dev_only`, `useAgent` returns that local agent.
       5. With no `runtimeUrl` and missing local agent, `useAgent` throws.
     - Where helpful, assert that the hook continues to re-render on message/state/run changes (existing subscription behavior).
   - Double-check React tests that rely on optional chaining like `agent?.isRunning` continue to compile (optional chaining on a definite value is allowed; these tests should not break). No changes needed.

6) DX: Error messaging
   - Include agent id and runtime url in thrown error text, and a short hint: “Verify agent registration in runtime `/info` and/or provider `agents__unsafe_dev_only`.”

7) Migration notes (not code-enforced, but document intent)
   - Code that previously handled `agent` possibly being `undefined` should either:
     - Rely on the provisional agent during runtime sync, or
     - Surround the hook usage with an error boundary if targeting agent ids that might not exist after sync.

Risk Assessment and Mitigations
- Potential double-connect when runtime transitions from pre-sync provisional → connected real agent.
  - Mitigation: The `CopilotChat` effect sets `threadId` and calls `connectAgent` for the current `agent`; when the agent object changes, the effect re-runs. Both `connect` and `run` paths already guard/ignore unsupported connect and log errors. This is acceptable and consistent with current patterns.
- Header/transport changes before sync.
  - Mitigation: Provisional agent identity is memoized on `(agentId, runtimeUrl, runtimeTransport, headers)`. Changing these will recreate the provisional agent appropriately.
- SSR safety.
  - Mitigation: Provisional agent construction performs no network I/O; network calls only occur on `connect`/`run`.

Acceptance Criteria
- `useAgent` never returns `undefined`.
- During runtime syncing, `useAgent` returns a usable `ProxiedCopilotRuntimeAgent`.
- Once runtime is synced (Connected or Error), unknown agent ids cause the hook to throw with a clear message.
- All existing unit tests pass unchanged.
- New hook tests cover the behaviors above.
- Docs reflect the updated `useAgent` semantics and return type.

