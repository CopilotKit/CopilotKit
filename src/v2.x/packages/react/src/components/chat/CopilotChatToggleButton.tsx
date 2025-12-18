import React, { useState, MouseEvent } from "react";
import { MessageCircle, X } from "lucide-react";

import { renderSlot, SlotValue } from "@/lib/slots";
import { cn } from "@/lib/utils";
import {
  CopilotChatDefaultLabels,
  useCopilotChatConfiguration,
} from "@/providers/CopilotChatConfigurationProvider";

const DefaultOpenIcon: React.FC<React.SVGProps<SVGSVGElement>> = ({
  className,
  ...props
}) => (
  <MessageCircle className={cn("h-6 w-6", className)} strokeWidth={1.75} fill="currentColor" {...props} />
);

const DefaultCloseIcon: React.FC<React.SVGProps<SVGSVGElement>> = ({
  className,
  ...props
}) => <X className={cn("h-6 w-6", className)} strokeWidth={1.75} {...props} />;

DefaultOpenIcon.displayName = "CopilotChatToggleButton.OpenIcon";
DefaultCloseIcon.displayName = "CopilotChatToggleButton.CloseIcon";

export interface CopilotChatToggleButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Optional slot override for the chat (closed) icon. */
  openIcon?: SlotValue<typeof DefaultOpenIcon>;
  /** Optional slot override for the close icon. */
  closeIcon?: SlotValue<typeof DefaultCloseIcon>;
}

const ICON_TRANSITION_STYLE: React.CSSProperties = Object.freeze({
  transition: "opacity 120ms ease-out, transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
});

const ICON_WRAPPER_BASE =
  "pointer-events-none absolute inset-0 flex items-center justify-center will-change-transform";

const BUTTON_BASE_CLASSES = cn(
  "fixed bottom-6 right-6 z-[1100] flex h-14 w-14 items-center justify-center",
  "rounded-full border border-primary bg-primary text-primary-foreground",
  "shadow-sm transition-all duration-200 ease-out",
  "hover:scale-[1.04] hover:shadow-md",
  "cursor-pointer",
  "active:scale-[0.96]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  "disabled:pointer-events-none disabled:opacity-60"
);

export const CopilotChatToggleButton = React.forwardRef<
  HTMLButtonElement,
  CopilotChatToggleButtonProps
>(function CopilotChatToggleButton({ openIcon, closeIcon, className, ...buttonProps }, ref) {
  const { onClick, type, disabled, ...restProps } = buttonProps;

  const configuration = useCopilotChatConfiguration();
  const labels = configuration?.labels ?? CopilotChatDefaultLabels;

  const [fallbackOpen, setFallbackOpen] = useState(false);

  const isOpen = configuration?.isModalOpen ?? fallbackOpen;
  const setModalOpen = configuration?.setModalOpen ?? setFallbackOpen;

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (disabled) {
      return;
    }

    if (onClick) {
      onClick(event);
    }

    if (event.defaultPrevented) {
      return;
    }

    const nextOpen = !isOpen;
    setModalOpen(nextOpen);
  };

  const renderedOpenIcon = renderSlot(
    openIcon,
    DefaultOpenIcon,
    {
      className: "h-6 w-6",
      "aria-hidden": true,
      focusable: false,
    }
  );

  const renderedCloseIcon = renderSlot(
    closeIcon,
    DefaultCloseIcon,
    {
      className: "h-6 w-6",
      "aria-hidden": true,
      focusable: false,
    }
  );

  const openIconElement = (
    <span
      aria-hidden="true"
      data-slot="chat-toggle-button-open-icon"
      className={ICON_WRAPPER_BASE}
      style={{
        ...ICON_TRANSITION_STYLE,
        opacity: isOpen ? 0 : 1,
        transform: `scale(${isOpen ? 0.75 : 1}) rotate(${isOpen ? 90 : 0}deg)`,
      }}
    >
      {renderedOpenIcon}
    </span>
  );

  const closeIconElement = (
    <span
      aria-hidden="true"
      data-slot="chat-toggle-button-close-icon"
      className={ICON_WRAPPER_BASE}
      style={{
        ...ICON_TRANSITION_STYLE,
        opacity: isOpen ? 1 : 0,
        transform: `scale(${isOpen ? 1 : 0.75}) rotate(${isOpen ? 0 : -90}deg)`,
      }}
    >
      {renderedCloseIcon}
    </span>
  );

  return (
    <button
      ref={ref}
      type={type ?? "button"}
      data-slot="chat-toggle-button"
      data-state={isOpen ? "open" : "closed"}
      className={cn(BUTTON_BASE_CLASSES, className)}
      aria-label={isOpen ? labels.chatToggleCloseLabel : labels.chatToggleOpenLabel}
      aria-pressed={isOpen}
      disabled={disabled}
      onClick={handleClick}
      {...restProps}
    >
      {openIconElement}
      {closeIconElement}
    </button>
  );
});
CopilotChatToggleButton.displayName = "CopilotChatToggleButton";
export default CopilotChatToggleButton;

export {
  DefaultOpenIcon as CopilotChatToggleButtonOpenIcon,
  DefaultCloseIcon as CopilotChatToggleButtonCloseIcon,
};
