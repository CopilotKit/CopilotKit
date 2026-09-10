"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { EyeOff, Wrench } from "lucide-react";
import { twMerge } from "tailwind-merge";
import { Button } from "../ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "../ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../ui/dropdown-menu";
import { useCopilotKitInspector } from "../CopilotKitInspectorContext";
import {
  CopilotChatDefaultLabels,
  useCopilotChatConfiguration,
} from "../../providers/CopilotChatConfigurationProvider";

// Page-lifetime preference, shared by every message and chat. Deliberately
// avoid sessionStorage: it survives reloads, while this preference must not.
let shortcutsHidden = false;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getSnapshot = () => shortcutsHidden;
const getServerSnapshot = () => false;

export function useInspectorShortcutsHidden() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function hideShortcuts() {
  shortcutsHidden = true;
  listeners.forEach((listener) => listener());
}

// Matches the Inspector launcher artwork in web-inspector/src/assets/inspector-logo-kite.svg.
function InspectorKiteIcon({
  className,
  ...props
}: React.SVGProps<SVGSVGElement>) {
  const id = useId();
  return (
    <svg
      {...props}
      aria-hidden="true"
      className={twMerge("cpk:size-4", className)}
      viewBox="4.57 3.36 17.8 17.8"
      fill="none"
    >
      <path
        d="M6.36084 10.9855C8.34277 8.393 9.98843 5.82939 10.6204 3.75914C10.6382 3.70281 10.7043 3.67888 10.7534 3.7114C12.9536 5.16894 16.9635 6.12833 20.5086 6.15085C20.5703 6.15124 20.6124 6.2114 20.5895 6.26829C19.4109 9.25938 17.9705 14.6189 17.9148 20.7392C17.9148 20.8301 17.7873 20.8627 17.7419 20.7837C15.7236 17.2522 9.26021 12.2898 6.39414 11.1186C6.34112 11.0968 6.32556 11.0313 6.36084 10.9855Z"
        fill={`url(#${id}-paint0_linear)`}
      />
      <path
        d="M13.0475 9.39974C9.95016 10.3806 7.11935 10.9259 6.44331 11.0498C6.40027 11.0577 6.39115 11.1172 6.43152 11.134C9.3203 12.3347 15.7516 17.2826 17.7511 20.7998C17.7551 20.8075 17.7647 20.8103 17.7728 20.8068C17.7809 20.803 17.7853 20.793 17.7819 20.7844L13.0475 9.39974Z"
        fill={`url(#${id}-paint1_linear)`}
      />
      <path
        d="M10.762 3.705C13.4137 5.15161 16.4787 5.80132 20.545 6.14367C20.5703 6.14585 20.5787 6.18008 20.5557 6.19197C20.0359 6.45923 17.0574 7.97512 14.8455 8.78701C14.2524 9.00453 13.6564 9.20632 13.0692 9.39249C13.0562 9.39656 13.0419 9.39015 13.0369 9.37774L10.7005 3.75979C10.6849 3.72196 10.7257 3.68538 10.762 3.705Z"
        fill={`url(#${id}-paint2_linear)`}
      />
      <path
        d="M10.7145 3.79041L17.8305 20.7659"
        stroke="#513C9F"
        strokeWidth="0.17284"
        strokeLinecap="round"
      />
      <path
        d="M6.44531 11.0476C6.44531 11.0476 10.375 10.3422 14.0686 9.06804C17.7623 7.7939 20.5122 6.23373 20.5122 6.23373"
        stroke="#513C9F"
        strokeWidth="0.17284"
        strokeLinecap="round"
      />
      <path
        d="M11.6914 5.93518L9.05534 14.7068M9.05534 14.7068H15.3203M9.05534 14.7068L0.15625 26.3646"
        stroke="#ABABAB"
        strokeWidth="0.302474"
        strokeLinecap="round"
      />
      <path
        d="M6.02539 23.9646L4.85806 24.1287C5.46272 25.7287 6.70381 26.4276 8.18528 26.4276C11.8147 26.4276 10.707 22.3227 12.8103 22.3227C14.3358 22.3227 13.7155 25.6498 16.9992 25.6498C19.0029 25.6498 19.2028 23.631 18.8607 22.7625C18.8589 22.7572 18.8568 22.7524 18.8538 22.7476L18.3166 21.9253C18.2817 21.8706 18.1968 21.8912 18.1907 21.9562L18.0908 22.9529C18.0838 23.0222 18.0857 23.0913 18.0936 23.1605C18.1764 23.8491 18.2291 25.5202 16.9992 25.5202C15.7015 25.5202 15.3895 22.2362 12.8103 22.2362C9.78393 22.2362 10.1726 26.298 8.31487 26.298C7.08938 26.298 6.15447 24.9153 6.02539 23.9646Z"
        fill={`url(#${id}-paint3_linear)`}
      />
      <defs>
        <linearGradient
          id={`${id}-paint0_linear`}
          x1="15.5372"
          y1="5.0278"
          x2="12.0802"
          y2="14.534"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#6430AB" />
          <stop offset="1" stopColor="#AA89D8" />
        </linearGradient>
        <linearGradient
          id={`${id}-paint1_linear`}
          x1="12.8583"
          y1="10.3858"
          x2="8.40764"
          y2="18.9846"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#005DBB" />
          <stop offset="1" stopColor="#3D92E8" />
        </linearGradient>
        <linearGradient
          id={`${id}-paint2_linear`}
          x1="14.8452"
          y1="5.02774"
          x2="13.5047"
          y2="9.21911"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#1B70C4" />
          <stop offset="1" stopColor="#54A4F2" />
        </linearGradient>
        <linearGradient
          id={`${id}-paint3_linear`}
          x1="4.85806"
          y1="24.2455"
          x2="18.9963"
          y2="24.2455"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#4497EA" />
          <stop offset="0.254755" stopColor="#1463B2" />
          <stop offset="0.498725" stopColor="#0A437D" />
          <stop offset="0.666667" stopColor="#2476C8" />
          <stop offset="0.972542" stopColor="#0C549A" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function CopilotChatInspectorButton({
  title,
  className,
  onClick,
  onPointerDown,
  onPointerEnter,
  onPointerLeave,
  onKeyDown,
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const config = useCopilotChatConfiguration();
  const labels = config?.labels ?? CopilotChatDefaultLabels;
  const { isInspectorEnabled } = useCopilotKitInspector();
  const hidden = useInspectorShortcutsHidden();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedByHover = useRef(false);
  const primaryLabel = title || labels.assistantMessageToolbarInspectorLabel;

  const cancelClose = () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  useEffect(() => cancelClose, []);

  const changeOpen = (next: boolean) => {
    cancelClose();
    if (next) setDark(!!trigger.current?.closest(".dark"));
    setOpen(next);
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      // Keep the panel available while the keyboard is interacting with it.
      if (openedByHover.current) setOpen(false);
    }, 180);
  };

  if (!isInspectorEnabled || hidden) return null;

  return (
    <DropdownMenu open={open} onOpenChange={changeOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          {...props}
          ref={trigger}
          type="button"
          disabled={disabled}
          variant="assistantMessageToolbarButton"
          size="icon"
          data-testid="copilot-inspector-button"
          aria-label={`${labels.assistantMessageToolbarInspectorTitle} (${labels.assistantMessageToolbarInspectorLocalOnlyLabel.toLowerCase()})`}
          className={twMerge("cpk:size-8 cpk:p-1.5", className)}
          onPointerEnter={(event) => {
            onPointerEnter?.(event);
            if (!disabled && event.pointerType !== "touch") {
              openedByHover.current = true;
              changeOpen(true);
            }
          }}
          onPointerLeave={(event) => {
            onPointerLeave?.(event);
            scheduleClose();
          }}
          onPointerDown={(event) => {
            onPointerDown?.(event);
            // Clicking inspects the message instead of toggling the menu.
            event.preventDefault();
          }}
          onClick={(event) => {
            changeOpen(false);
            onClick?.(event);
          }}
          onKeyDown={(event) => {
            openedByHover.current = false;
            onKeyDown?.(event);
            if (
              !event.defaultPrevented &&
              (event.key === "Enter" || event.key === " ")
            ) {
              event.preventDefault();
              event.currentTarget.click();
            }
          }}
        >
          <Wrench
            aria-hidden="true"
            className="cpk:size-4"
            data-testid="copilot-inspector-icon"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={6}
        className={twMerge("cpk:w-64 cpk:p-1 cpk:text-sm", dark && "dark")}
        onPointerEnter={cancelClose}
        onPointerLeave={scheduleClose}
        onKeyDown={() => {
          openedByHover.current = false;
        }}
        onOpenAutoFocus={(event) => {
          if (openedByHover.current) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          if (openedByHover.current) event.preventDefault();
        }}
        onFocusOutside={() => changeOpen(false)}
      >
        <DropdownMenuLabel className="cpk:flex cpk:items-center cpk:justify-between cpk:gap-3 cpk:px-2 cpk:py-2">
          <span className="cpk:text-xs cpk:font-medium">
            {labels.assistantMessageToolbarInspectorTitle}
          </span>
          <Tooltip delayDuration={1000}>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                className="cpk:cursor-help cpk:rounded cpk:bg-muted cpk:px-1.5 cpk:py-0.5 cpk:text-[10px] cpk:font-normal cpk:text-muted-foreground"
              >
                {labels.assistantMessageToolbarInspectorLocalOnlyLabel}
              </span>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              sideOffset={6}
              className={twMerge("cpk:max-w-48 cpk:text-wrap", dark && "dark")}
              onPointerEnter={cancelClose}
              onPointerLeave={scheduleClose}
            >
              {labels.assistantMessageToolbarInspectorLocalOnlyDescription}
            </TooltipContent>
          </Tooltip>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <button
            type="button"
            onClick={onClick}
            className="cpk:w-full cpk:cursor-pointer cpk:items-start cpk:text-left"
          >
            <InspectorKiteIcon className="cpk:mt-0.5" />
            <span>
              <span className="cpk:block">{primaryLabel}</span>
              <span className="cpk:block cpk:text-xs cpk:text-muted-foreground">
                {labels.assistantMessageToolbarInspectorDescription}
              </span>
            </span>
          </button>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={hideShortcuts}
          className="cpk:cursor-pointer cpk:items-start"
        >
          <EyeOff aria-hidden="true" className="cpk:mt-0.5" />
          <span>
            <span className="cpk:block">
              {labels.assistantMessageToolbarInspectorHideLabel}
            </span>
            <span className="cpk:block cpk:text-xs cpk:text-muted-foreground">
              {labels.assistantMessageToolbarInspectorHideDescription}
            </span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
