import { useEffect } from "react";
import { useCopilotContext } from "@copilotkit/react-core";
import type { CapturedRegistry } from "./registry";

// The V2 CopilotKit provider is mounted by the V1 CopilotKit wrapper, so V2
// state is always reachable from inside a V1 tree. We import `useCopilotKit`
// lazily through `@copilotkit/react-core/v2` so this file stays decoupled from
// internal V1 implementation details.
import { useCopilotKit } from "@copilotkit/react-core/v2";

type V2Access = { copilotkit?: unknown } | null;

export function RegistryReader({
  onCapture,
  v2,
}: {
  onCapture: (reg: CapturedRegistry) => void;
  // `v2` is accepted for parity with the harness API but is unused at runtime.
  // The V2 provider is always mounted inside a V1 <CopilotKit>, so we read V2
  // state via the hook below. The prop exists so callers running an out-of-tree
  // V2 core (e.g. custom mounts without V1) can still feed one in later.
  v2?: V2Access;
}) {
  const v1ctx = useCopilotContext();
  const { copilotkit } = useCopilotKit();

  useEffect(() => {
    function capture() {
      const v2core = copilotkit as unknown as {
        renderToolCalls?: ReadonlyArray<{ name: string; [k: string]: unknown }>;
        tools?: ReadonlyArray<{ name: string; [k: string]: unknown }>;
        subscribe?: (s: { onRenderToolCallsChanged?: () => void }) => {
          unsubscribe: () => void;
        };
      };
      const v1state = v1ctx as unknown as {
        coAgentStateRenders?: Array<{ name?: string; [k: string]: unknown }>;
        chatComponentsCache?: unknown;
      };
      onCapture({
        renderToolCalls: v2core.renderToolCalls?.slice() ?? [],
        tools: v2core.tools?.slice() ?? [],
        coAgentStateRenders: v1state.coAgentStateRenders?.slice() ?? [],
        chatComponents: v1state.chatComponentsCache ?? null,
      });
    }

    // Capture immediately so a consumer at least gets the initial snapshot,
    // then schedule a deferred capture so host-side effects (which register
    // actions in their own `useEffect`s, potentially running after this one
    // since effects fire in tree order) are picked up on the final snapshot.
    //
    // Note: V1's `useRenderToolCall` mutates `copilotkit.renderToolCalls`
    // directly without calling `_notifyRenderToolCallsChanged`, so the V2
    // `onRenderToolCallsChanged` subscription does NOT fire for V1-hook
    // registrations. We subscribe anyway so V2-native registrations (via
    // `addHookRenderToolCall`, which does notify) still re-trigger capture,
    // but the `setTimeout(0)` is what carries V1 hooks across the finish line.
    capture();
    const deferredHandle = setTimeout(capture, 0);

    const subscription = (
      copilotkit as unknown as {
        subscribe?: (s: {
          onRenderToolCallsChanged?: () => void;
        }) => { unsubscribe: () => void };
      }
    ).subscribe?.({
      onRenderToolCallsChanged: () => {
        capture();
      },
    });

    return () => {
      clearTimeout(deferredHandle);
      subscription?.unsubscribe();
    };
    // v2 prop is intentionally excluded; `copilotkit` is a stable ref across
    // the provider's lifetime so this effect runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copilotkit, onCapture]);

  // Mark `v2` as used for TypeScript's `noUnusedParameters`.
  void v2;

  return null;
}
