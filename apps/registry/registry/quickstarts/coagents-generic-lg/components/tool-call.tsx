import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CatchAllActionRenderProps } from "@copilotkit/react-core";

export function ToolCall(toolCallProps: CatchAllActionRenderProps) {
  const triggerStyles = "inline-flex rounded-xl items-center gap-2 p-2 rounded bg-indigo-500/60 text-white cursor-pointer m-1";
  const contentStyles = "bg-white rounded-xl min-w-[300px] max-w-[500px] p-4 border";
  const statusStyles = "text-xs px-2 py-0.5 rounded-full bg-pink-200/40 text-white";

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={triggerStyles}>
            <span className="pr-2">🔧</span>  {toolCallProps.name}
            <span className={statusStyles}>{toolCallProps.status}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent
          side="right" 
          align="center" 
          className={contentStyles}
        >
          <ToolCallInformation {...toolCallProps} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const ToolCallInformation = (toolCallProps: CatchAllActionRenderProps) => {
  const { name, args, status, result } = toolCallProps;

  const wrapperStyles = "flex flex-col gap-2 max-h-[400px] overflow-y-auto text-black";
  const titleStyles = "flex flex-col gap-1";
  const contentStyles = "flex flex-col gap-1";
  const preStyles = "bg-indigo-500/10 p-2 rounded text-sm overflow-auto max-h-[200px] m-0 whitespace-pre-wrap break-words";

  return (
    <div className={wrapperStyles}>
      <div className={titleStyles}>
        <strong>Name:</strong> {name}
      </div>
      <div className={contentStyles}>
        <strong>Arguments:</strong> 
        <pre className={preStyles}>
          {JSON.stringify(args, null, 2)}
        </pre>
      </div>
      <div className={contentStyles}>
        <strong>Status:</strong> {status}
      </div>
      <div className={contentStyles}>
        <strong>Result:</strong> 
        <pre className={preStyles}>
          {JSON.stringify(result, null, 2)}
        </pre>
      </div>
    </div>
  );
}