import React, { useCallback } from "react";

import { cn } from "@/lib/utils";
import {
  useCopilotChatConfiguration,
  CopilotChatDefaultLabels,
} from "@/providers/CopilotChatConfigurationProvider";
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

  const fallbackTitle =
    configuration?.labels.modalHeaderTitle ??
    CopilotChatDefaultLabels.modalHeaderTitle;
  const resolvedTitle = title ?? fallbackTitle;

  const handleClose = useCallback(() => {
    configuration?.setModalOpen?.(false);
  }, [configuration]);

  const BoundTitle = renderSlot(titleContent, CopilotModalHeader.Title, {
    children: resolvedTitle,
  });

  const BoundCloseButton = renderSlot(
    closeButton,
    CopilotModalHeader.CloseButton,
    {
      onClick: handleClose,
    },
  );

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
      data-testid="copilot-modal-header"
      data-slot="copilot-modal-header"
      className={cn(
        "cpk:flex cpk:items-center cpk:justify-between cpk:border-b cpk:border-border cpk:px-4 cpk:py-4",
        "cpk:bg-background/95 cpk:backdrop-blur cpk:supports-[backdrop-filter]:bg-background/80",
        className,
      )}
      {...rest}
    >
      <div className="cpk:flex cpk:w-full cpk:items-center cpk:gap-2">
        <div className="cpk:flex-1" aria-hidden="true" />
        <div className="cpk:flex cpk:flex-1 cpk:justify-center cpk:text-center">
          {BoundTitle}
        </div>
        <div className="cpk:flex cpk:flex-1 cpk:justify-end">
          {BoundCloseButton}
        </div>
      </div>
    </header>
  );
}

CopilotModalHeader.displayName = "CopilotModalHeader";

export namespace CopilotModalHeader {
  export const Title: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
    children,
    className,
    ...props
  }) => (
    <div
      data-testid="copilot-header-title"
      className={cn(
        "cpk:w-full cpk:text-base cpk:font-medium cpk:leading-none cpk:tracking-tight cpk:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );

  export const CloseButton: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement>
  > = ({ className, ...props }) => (
    <button
      type="button"
      data-testid="copilot-close-button"
      className={cn(
        "cpk:inline-flex cpk:size-8 cpk:items-center cpk:justify-center cpk:rounded-full cpk:text-muted-foreground cpk:transition cpk:cursor-pointer",
        "cpk:hover:bg-muted cpk:hover:text-foreground cpk:focus-visible:outline-none cpk:focus-visible:ring-2 cpk:focus-visible:ring-ring",
        className,
      )}
      aria-label="Close"
      {...props}
    >
      <X className="cpk:h-4 cpk:w-4" aria-hidden="true" />
    </button>
  );
}

CopilotModalHeader.Title.displayName = "CopilotModalHeader.Title";
CopilotModalHeader.CloseButton.displayName = "CopilotModalHeader.CloseButton";

export default CopilotModalHeader;
