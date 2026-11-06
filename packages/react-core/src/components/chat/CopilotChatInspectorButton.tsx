"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { CopilotIcon } from "../icons/CopilotIcon";
import { cn } from "../../lib/utils";
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
  ɵHoverMenuController,
  ɵinspectorKiteFill,
  ɵinspectorKiteIcon,
  ɵinspectorShortcuts,
} from "@copilotkit/core";
import { useCopilotChatConfiguration } from "../../providers/CopilotChatConfigurationProvider";

const subscribeToShortcuts = (listener: () => void) =>
  ɵinspectorShortcuts.subscribe(listener);
const getShortcutsHidden = () => ɵinspectorShortcuts.hidden;
const getServerShortcutsHidden = () => false;

/** Whether the user hid the Inspector shortcuts until the page reloads. */
export function useInspectorShortcutsHidden() {
  return useSyncExternalStore(
    subscribeToShortcuts,
    getShortcutsHidden,
    getServerShortcutsHidden,
  );
}

const hideShortcuts = () => ɵinspectorShortcuts.hide();

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
      className={cn("cpk-inspector-button-kite-icon", className)}
      viewBox={ɵinspectorKiteIcon.viewBox}
      fill="none"
    >
      {ɵinspectorKiteIcon.paths.map((path) => (
        <path
          key={path.d}
          d={path.d}
          fill={ɵinspectorKiteFill(id, path)}
          stroke={path.stroke}
          strokeWidth={path.strokeWidth}
          strokeLinecap={path.strokeLinecap}
        />
      ))}
      <defs>
        {ɵinspectorKiteIcon.gradients.map((gradient) => (
          <linearGradient
            key={gradient.id}
            id={`${id}-${gradient.id}`}
            x1={gradient.x1}
            y1={gradient.y1}
            x2={gradient.x2}
            y2={gradient.y2}
            gradientUnits="userSpaceOnUse"
          >
            {gradient.stops.map((stop) => (
              <stop
                key={`${stop.offset ?? "0"}-${stop.color}`}
                offset={stop.offset}
                stopColor={stop.color}
              />
            ))}
          </linearGradient>
        ))}
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
  const [menu] = useState(() => new ɵHoverMenuController());
  const { open, dark } = useSyncExternalStore(
    menu.subscribe,
    menu.getSnapshot,
    menu.getSnapshot,
  );
  const trigger = useRef<HTMLButtonElement>(null);
  const primaryLabel = title || labels.assistantMessageToolbarInspectorLabel;
  useEffect(() => menu.dispose, [menu]);

  const { cancelClose, scheduleClose } = menu;
  const changeOpen = (next: boolean) => menu.setOpen(next, trigger.current);

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
          className={cn("cpk-inspector-button", className)}
          onPointerEnter={(event) => {
            onPointerEnter?.(event);
            menu.pointerEnter({
              pointerType: event.pointerType,
              disabled,
              trigger: trigger.current,
            });
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
            menu.keyboardUsed();
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
          <CopilotIcon
            name="Wrench"
            aria-hidden="true"
            className="cpk-inspector-button-icon"
            data-testid="copilot-inspector-icon"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={6}
        className={cn("cpk-inspector-button-menu", dark && "dark")}
        onPointerEnter={cancelClose}
        onPointerLeave={scheduleClose}
        onKeyDown={menu.keyboardUsed}
        onOpenAutoFocus={(event) => {
          if (menu.openedByHover) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          if (menu.openedByHover) event.preventDefault();
        }}
        onFocusOutside={() => changeOpen(false)}
      >
        <DropdownMenuLabel className="cpk-inspector-button-menu-header">
          <span className="cpk-inspector-button-menu-title">
            {labels.assistantMessageToolbarInspectorTitle}
          </span>
          <Tooltip delayDuration={1000}>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="cpk-inspector-button-local-badge">
                {labels.assistantMessageToolbarInspectorLocalOnlyLabel}
              </span>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              sideOffset={6}
              className={cn(
                "cpk-inspector-button-local-tooltip",
                dark && "dark",
              )}
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
            className="cpk-inspector-button-menu-item cpk-inspector-button-inspect-item"
          >
            <InspectorKiteIcon className="cpk-inspector-button-menu-item-icon" />
            <span>
              <span className="cpk-inspector-button-menu-item-label">
                {primaryLabel}
              </span>
              <span className="cpk-inspector-button-menu-item-description">
                {labels.assistantMessageToolbarInspectorDescription}
              </span>
            </span>
          </button>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={hideShortcuts}
          className="cpk-inspector-button-menu-item cpk-inspector-button-hide-item"
        >
          <CopilotIcon
            name="EyeOff"
            aria-hidden="true"
            className="cpk-inspector-button-menu-item-icon"
          />
          <span>
            <span className="cpk-inspector-button-menu-item-label">
              {labels.assistantMessageToolbarInspectorHideLabel}
            </span>
            <span className="cpk-inspector-button-menu-item-description">
              {labels.assistantMessageToolbarInspectorHideDescription}
            </span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
