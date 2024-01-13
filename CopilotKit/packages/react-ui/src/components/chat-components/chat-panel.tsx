import { type UseChatHelpers } from "@copilotkit/react-core";

import { Button } from "./ui/button";
import { PromptForm } from "./prompt-form";
import { IconRefresh, IconStop } from "./ui/icons";
import { nanoid } from "nanoid";

export interface ChatPanelProps
  extends Pick<
    UseChatHelpers,
    "append" | "isLoading" | "reload" | "messages" | "stop" | "input" | "setInput"
  > {
  id?: string;
}

export function ChatPanel({
  id,
  isLoading,
  stop,
  append,
  reload,
  input,
  setInput,
  messages,
}: ChatPanelProps) {
  return (
    <div
      className="inset-x-0 bottom-0 bg-gradient-to-b from-muted/10 from-10% to-muted/30 to-50% mt-4 mb-8"
      style={{ width: "100%", overflow: "hidden", boxSizing: "border-box" }}
    >
      <div className="mx-auto sm:max-w-2xl sm:px-4">
        <div className="flex h-10 items-center justify-center mb-4">
          {isLoading ? (
            <Button variant="outline" onClick={() => stop()} className="bg-background">
              <IconStop className="mr-2" />
              Stop generating
            </Button>
          ) : (
            messages?.length > 0 && (
              <Button variant="outline" onClick={() => reload()} className="bg-background">
                <IconRefresh className="mr-2" />
                Regenerate response
              </Button>
            )
          )}
        </div>
        <div className="space-y-4 border-2 bg-background px-4 py-2 shadow-lg sm:rounded-xl md:py-4">
          <PromptForm
            onSubmit={async (value) => {
              await append({
                id: id || nanoid(),
                content: value,
                role: "user",
              });
            }}
            input={input}
            setInput={setInput}
            isLoading={isLoading}
          />
        </div>
      </div>
    </div>
  );
}
