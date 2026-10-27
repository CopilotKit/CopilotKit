import { useAgentContext } from "@copilotkit/react-core/v2";
import type { CopilotChatInputProps } from "@copilotkit/react-core/v2";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { useDesk } from "../lib/desk-store";
import type { ModelId } from "../lib/models";
import type { ViewKind } from "../lib/view-catalog";
import { AddMenu } from "./AddMenu";
import { ModelPicker } from "./ModelPicker";

/** The parts CopilotChatInput hands to its `children` render prop. */
type ComposerParts = Parameters<
  NonNullable<CopilotChatInputProps["children"]>
>[0];

/** While mounted, tells the agent which view the reader asked for. */
function ViewRequestContext({ view }: { view: ViewKind }) {
  useAgentContext({
    description: "The view the reader asked for with this question",
    value: `${view.label}. ${view.instruction}`,
  });
  return null;
}

/**
 * The composer: the question on top; under it, the view the reader asked
 * for (if any) on the left, and the model, + and send on the right. It keeps
 * CopilotKit's positioning contract (containerRef, pinned or inline) so the
 * chat still measures it and scrolls above it.
 */
export function Composer({
  parts,
  model,
  onModelChange,
}: {
  parts: ComposerParts;
  model: ModelId;
  onModelChange: (model: ModelId) => void;
}) {
  const { viewRequest, requestView } = useDesk();
  const pinned = parts.positioning === "absolute";

  // A picked view rides with one question: clear it once that run starts.
  const wasRunning = useRef(parts.isRunning);
  useEffect(() => {
    if (parts.isRunning && !wasRunning.current) requestView(null);
    wasRunning.current = parts.isRunning;
  }, [parts.isRunning, requestView]);

  return (
    <div
      ref={parts.containerRef}
      className="composer-dock"
      data-pinned={pinned || undefined}
      style={
        parts.keyboardHeight
          ? { transform: `translateY(-${parts.keyboardHeight}px)` }
          : undefined
      }
    >
      {viewRequest && <ViewRequestContext view={viewRequest} />}
      <div className="composer">
        <div className="composer__field">{parts.textArea}</div>
        <div className="composer__bar">
          <div className="composer__start">
            <ModelPicker
              value={model}
              onChange={onModelChange}
              placement="up"
            />
            {viewRequest && (
              <span
                className="composer__view"
                style={{ "--view-tone": viewRequest.tone } as CSSProperties}
              >
                <viewRequest.icon size={14} strokeWidth={2} aria-hidden />
                {viewRequest.label}
                <button
                  type="button"
                  className="composer__view-clear"
                  aria-label={`Don't ask for a ${viewRequest.label.toLowerCase()}`}
                  onClick={() => requestView(null)}
                >
                  <X size={12} strokeWidth={2.25} aria-hidden />
                </button>
              </span>
            )}
          </div>
          <div className="composer__end">
            <AddMenu
              onAddImage={parts.onAddFile}
              onPickView={requestView}
              picked={viewRequest}
            />
            {parts.sendButton}
          </div>
        </div>
      </div>
      {parts.showDisclaimer && (
        <div className="composer__disclaimer">{parts.disclaimer}</div>
      )}
    </div>
  );
}
