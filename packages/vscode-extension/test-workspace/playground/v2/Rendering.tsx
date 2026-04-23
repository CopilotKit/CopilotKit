import {
  useRenderCustomMessages,
  useRenderActivityMessage,
} from "@copilotkit/react-core/v2";

export function Rendering() {
  // V2 render: custom renderer for user-defined message types
  // @ts-expect-error – test-workspace only
  useRenderCustomMessages({
    render: () => <div>Custom message</div>,
  });

  // V2 render: renderer for activity / status messages (e.g. "Thinking…")
  // @ts-expect-error – test-workspace only
  useRenderActivityMessage({
    render: () => <div>Activity in progress…</div>,
  });

  return <div>v2 rendering</div>;
}
