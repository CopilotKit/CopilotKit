import React, { useCallback } from "react";

import { cn } from "@/lib/utils";
import { useCopilotChatConfiguration, CopilotChatDefaultLabels } from "@/providers/CopilotChatConfigurationProvider";
import { renderSlot, WithSlots } from "@/lib/slots";
import { X } from "lucide-react";

type HeaderSlots = {
  titleContent: typeof CopilotModalHeader.Title;
  closeButton: typeof CopilotModalHeader.CloseButton;
};

type HeaderRestProps = {
  title?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "children">;

export type CopilotModalHeaderProps = WithSlots<HeaderSlots, HeaderRestProps>;

export function CopilotModalHeader({
  title,
  titleContent,
  closeButton,
  children,
  className,
  ...rest
}: CopilotModalHeaderProps) {
  const configuration = useCopilotChatConfiguration();

  const fallbackTitle = configuration?.labels.modalHeaderTitle ?? CopilotChatDefaultLabels.modalHeaderTitle;
  const resolvedTitle = title ?? fallbackTitle;

  const handleClose = useCallback(() => {
    configuration?.setModalOpen(false);
  }, [configuration]);

  const BoundTitle = renderSlot(titleContent, CopilotModalHeader.Title, {
    children: resolvedTitle,
  });

  const BoundCloseButton = renderSlot(closeButton, CopilotModalHeader.CloseButton, {
    onClick: handleClose,
  });

  if (children) {
    return children({
      titleContent: BoundTitle,
      closeButton: BoundCloseButton,
      title: resolvedTitle,
      ...rest,
    });
  }

  return (
    <header
      data-slot="copilot-modal-header"
      className={cn(
        "flex items-center justify-between border-b border-border px-4 py-4",
        "bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
        className,
      )}
      {...rest}
    >
      <div className="flex w-full items-center gap-2">
        <div className="flex-1" aria-hidden="true" />
        <div className="flex flex-1 justify-center text-center">{BoundTitle}</div>
        <div className="flex flex-1 justify-end">{BoundCloseButton}</div>
      </div>
    </header>
  );
}

CopilotModalHeader.displayName = "CopilotModalHeader";

export namespace CopilotModalHeader {
  export const Title: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ children, className, ...props }) => (
    <div
      className={cn(
        "w-full text-base font-medium leading-none tracking-tight text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );

  export const CloseButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({
    className,
    ...props
  }) => (
    <button
      type="button"
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition cursor-pointer",
        "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      aria-label="Close"
      {...props}
    >
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

CopilotModalHeader.Title.displayName = "CopilotModalHeader.Title";
CopilotModalHeader.CloseButton.displayName = "CopilotModalHeader.CloseButton";

export default CopilotModalHeader;
