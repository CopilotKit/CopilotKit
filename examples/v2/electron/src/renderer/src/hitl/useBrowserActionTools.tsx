import { useHumanInTheLoop } from "@copilotkit/react-core/v2";
import { ToolCallStatus } from "@copilotkit/core";
import { z } from "zod";
import { ApprovalCard } from "./ApprovalCard";

export function useBrowserActionTools(): void {
  useHumanInTheLoop<{ url: string }>({
    name: "browser_navigate",
    description: "Navigate the browser to a URL",
    parameters: z.object({ url: z.string() }),
    render: ({ args, status, result, respond }) => {
      const detail = args?.url ?? "";

      if (status === ToolCallStatus.Executing && respond) {
        return (
          <ApprovalCard
            title="Navigate to URL?"
            detail={detail}
            onApprove={async () => {
              const res = await window.electron.bridge.action("navigate", {
                url: args.url,
              });
              await respond(JSON.stringify({ approved: true, ...res }));
            }}
            onDeny={() => void respond(JSON.stringify({ approved: false }))}
          />
        );
      }

      return (
        <ApprovalCard
          title="Navigate to URL?"
          detail={detail}
          outcome={typeof result === "string" ? result : undefined}
        />
      );
    },
  });

  useHumanInTheLoop<{ selector: string }>({
    name: "browser_click",
    description: "Click an element on the page",
    parameters: z.object({ selector: z.string() }),
    render: ({ args, status, result, respond }) => {
      const detail = args?.selector ?? "";

      if (status === ToolCallStatus.Executing && respond) {
        return (
          <ApprovalCard
            title="Click element?"
            detail={detail}
            onApprove={async () => {
              const res = await window.electron.bridge.action("click", {
                selector: args.selector,
              });
              await respond(JSON.stringify({ approved: true, ...res }));
            }}
            onDeny={() => void respond(JSON.stringify({ approved: false }))}
          />
        );
      }

      return (
        <ApprovalCard
          title="Click element?"
          detail={detail}
          outcome={typeof result === "string" ? result : undefined}
        />
      );
    },
  });

  useHumanInTheLoop<{ selector: string; value: string }>({
    name: "browser_fill",
    description: "Fill an input field on the page",
    parameters: z.object({ selector: z.string(), value: z.string() }),
    render: ({ args, status, result, respond }) => {
      const detail = `${args?.selector ?? ""} = ${args?.value ?? ""}`;

      if (status === ToolCallStatus.Executing && respond) {
        return (
          <ApprovalCard
            title="Fill input field?"
            detail={detail}
            onApprove={async () => {
              const res = await window.electron.bridge.action("fill", {
                selector: args.selector,
                value: args.value,
              });
              await respond(JSON.stringify({ approved: true, ...res }));
            }}
            onDeny={() => void respond(JSON.stringify({ approved: false }))}
          />
        );
      }

      return (
        <ApprovalCard
          title="Fill input field?"
          detail={detail}
          outcome={typeof result === "string" ? result : undefined}
        />
      );
    },
  });
}
