import { useEffect } from "react";
import { useRenderTool, ToolCallStatus } from "@copilotkit/react-core/v2";

function Highlighter({
  elementId,
  elementType,
  status,
}: {
  elementId: string;
  elementType: string;
  status: string;
}) {
  useEffect(() => {
    if (status !== ToolCallStatus.Complete || !elementId) return;

    const classes = ["ring-4", "ring-primary", "ring-offset-2", "transition-all", "duration-500", "z-50", "relative"];

    try {
      const el = document.querySelector(`[data-element-id="${elementId}"]`) || 
                 document.querySelector(`[data-element-number="${elementId}"]`);
      if (el) {
        el.classList.add(...classes);
        el.scrollIntoView({ behavior: "smooth", block: "center" });

        // Clean up when this tool render unmounts (new message / page change)
        return () => {
          el.classList.remove(...classes);
        };
      }
    } catch (e) {
      console.error("Failed to highlight", e);
    }
  }, [status, elementId]);

  return null; // Side-effect only tool
}

export function useSemanticHighlight() {
  useRenderTool({

      name: "highlight_ui_element",
      render: ({ args , status  }: any) => (
        <Highlighter
          elementId={args?.elementId ?? ""}
          elementType={args?.elementType ?? ""}
          status={status}
        />
      ),
    } as any, []);
}
