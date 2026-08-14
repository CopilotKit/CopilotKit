import React, { useCallback, useRef, useState } from "react";
import type { UseThreadRestoreResult } from "../../hooks/use-thread-restore";
import {
  CopilotChatDefaultLabels,
  useCopilotChatConfiguration,
} from "../../providers/CopilotChatConfigurationProvider";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

export interface CopilotChatRestoreViewProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children"
> {
  threadRestore: UseThreadRestoreResult;
}

/** Default full-chat gate shown while a conversation is restoring or failed. */
export function CopilotChatRestoreView({
  threadRestore,
  className,
  ...props
}: CopilotChatRestoreViewProps) {
  const labels =
    useCopilotChatConfiguration()?.labels ?? CopilotChatDefaultLabels;
  const reloadConversation = threadRestore.reloadConversation;
  const reloadInFlightRef = useRef(false);
  const [isReloading, setIsReloading] = useState(false);

  const handleReload = useCallback(async () => {
    if (reloadInFlightRef.current) return;
    reloadInFlightRef.current = true;
    setIsReloading(true);
    try {
      await reloadConversation();
    } finally {
      reloadInFlightRef.current = false;
      setIsReloading(false);
    }
  }, [reloadConversation]);

  if (threadRestore.status === "ready") return null;

  return (
    <div
      data-copilotkit
      data-testid="copilot-chat-restore"
      className={cn(
        "copilotKitChat cpk:h-full cpk:flex cpk:items-center cpk:justify-center cpk:px-6 cpk:text-center",
        className,
      )}
      {...props}
    >
      {threadRestore.status === "restoring" ? (
        <div
          role="status"
          aria-live="polite"
          className="cpk:text-sm cpk:text-muted-foreground"
        >
          {labels.restoreLoadingText}
        </div>
      ) : (
        <div
          role="alert"
          className="cpk:flex cpk:max-w-sm cpk:flex-col cpk:items-center cpk:gap-3"
        >
          <p className="cpk:m-0 cpk:text-sm cpk:font-medium cpk:text-foreground">
            {labels.restoreFailedText}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={handleReload}
            disabled={isReloading}
          >
            {labels.restoreReloadButtonLabel}
          </Button>
          <p className="cpk:m-0 cpk:text-xs cpk:text-muted-foreground">
            {labels.restoreSupportIdLabel}: {threadRestore.restoreAttemptId}
          </p>
        </div>
      )}
    </div>
  );
}

export default CopilotChatRestoreView;
