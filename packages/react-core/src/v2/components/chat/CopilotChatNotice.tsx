import React from "react";
import { Button } from "../../components/ui/button";

export type CopilotChatNoticeProps = {
  message: string;
  onDismiss?: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

/** A nonmodal status notice supplied by the application and rendered in chat. */
export function CopilotChatNotice({
  message,
  onDismiss,
}: CopilotChatNoticeProps) {
  return (
    <section
      role="status"
      data-testid="copilot-status-notice"
      className="cpk:mx-4 cpk:mb-2 cpk:rounded-xl cpk:border cpk:border-border cpk:bg-background cpk:p-4 cpk:shadow-md"
    >
      <p className="cpk:whitespace-pre-wrap cpk:text-sm">{message}</p>
      {onDismiss && (
        <div className="cpk:mt-3 cpk:flex cpk:justify-end">
          <Button type="button" variant="outline" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      )}
    </section>
  );
}
