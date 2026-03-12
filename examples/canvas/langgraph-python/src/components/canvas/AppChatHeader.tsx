"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { X } from "lucide-react";
import { useChatContext, HeaderProps } from "@copilotkit/react-ui";

export function AppChatHeader({ onClose }: { onClose?: () => void }) {
  return (
    <div className="p-4 border-b border-sidebar-border">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar className="size-8">
            <AvatarFallback className="bg-accent/10 text-sidebar-primary-foreground">
              <span>🪁</span>
            </AvatarFallback>
          </Avatar>
          <div>
            <h3 className="font-bold text-sidebar-foreground">CopilotKit Canvas</h3>
            <div className="flex items-center gap-x-1.5 text-xs text-muted-foreground">
              <div className="inline-block size-1.5 rounded-full bg-green-500" />
              <div>Online <span className="opacity-50 text-[90%] select-none">•</span> Ready to help</div>
            </div>
          </div>
        </div>
        {typeof onClose === "function" && (
          <button
            type="button"
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:text-foreground hover:bg-accent/10"
            onClick={() => onClose?.()}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export function PopupHeader({}: HeaderProps) {
  const { setOpen } = useChatContext();
  return <AppChatHeader onClose={() => setOpen(false)} />;
}

export default AppChatHeader;


