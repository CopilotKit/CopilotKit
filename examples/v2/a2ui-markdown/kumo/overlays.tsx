"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  Button as KumoButton,
  Dialog,
  Popover as KumoPopover,
} from "@cloudflare/kumo";
import {
  useGenerativeUIAccessibility,
  useGenerativeUIRuntime,
} from "@copilotkit/react-core/v2/generative-ui";
import { usePhosphorIcon } from "./icons";
import { sizeOf } from "./style";
import type { StandardProps } from "./types";

/**
 * Kumo portals its overlays to the end of <body>, out of the surface. Like
 * the standard Modal, the portaled content takes the theme variables and
 * the `.a2ui-surface` style scope with it, so standard components in it
 * keep the Kumo theme.
 */
function SurfaceScope({ children }: { children: ReactNode }) {
  const theme = useGenerativeUIRuntime()?.theme;
  const style = useMemo((): CSSProperties => {
    const { mapStyle: _mapStyle, dark: _dark, ...variables } = theme ?? {};
    return { display: "contents", ...(variables as CSSProperties) };
  }, [theme]);
  return (
    <div className="a2ui-surface" style={style}>
      {children}
    </div>
  );
}

// ---- Popover ----

/** How the Popover opens on hover, for its trigger. */
const PopoverHoverContext = createContext<{
  openOnHover?: boolean;
  delay?: number;
}>({});

/** Popover: a Kumo Popover. `open` is writable, like the standard one. */
export function Popover(props: StandardProps<"Popover">) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = props.open ?? ownOpen;
  const setOpen = (value: boolean) => {
    setOwnOpen(value);
    props.setOpen(value);
  };
  const hover = useMemo(
    () => ({ openOnHover: props.showOnHover, delay: props.hoverOpenDelay }),
    [props.showOnHover, props.hoverOpenDelay],
  );
  return (
    <PopoverHoverContext.Provider value={hover}>
      <KumoPopover.Root open={open} onOpenChange={setOpen}>
        {props.children}
      </KumoPopover.Root>
    </PopoverHoverContext.Provider>
  );
}

/** PopoverTrigger: a Kumo Popover trigger, drawn as a Kumo Button. */
export function PopoverTrigger(props: StandardProps<"PopoverTrigger">) {
  const hover = useContext(PopoverHoverContext);
  return (
    <KumoPopover.Trigger
      openOnHover={hover.openOnHover}
      delay={hover.delay}
      render={
        <KumoButton
          variant="secondary"
          size="sm"
          style={props.block ? { width: "100%" } : undefined}
        />
      }
    >
      {props.children}
    </KumoPopover.Trigger>
  );
}

/** PopoverContent: the Kumo Popover popup. */
export function PopoverContent(props: StandardProps<"PopoverContent">) {
  return (
    <KumoPopover.Content
      side={props.side}
      align={props.align}
      sideOffset={props.sideOffset ?? 6}
    >
      <SurfaceScope>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            width: sizeOf(props.width),
            maxWidth: "min(360px, 90vw)",
          }}
        >
          {props.children}
        </div>
      </SurfaceScope>
    </KumoPopover.Content>
  );
}

// ---- Modal ----

type KumoDialogSize = "sm" | "base" | "lg" | "xl";

/** Pixels of a standard size value: 4px steps, or "NNNpx". */
function pixelsOf(value: number | string | undefined) {
  if (typeof value === "number") return value * 4;
  const match =
    typeof value === "string" ? /^(\d+(?:\.\d+)?)px$/.exec(value) : null;
  return match ? Number(match[1]) : undefined;
}

/**
 * The Kumo Dialog size nearest a standard `maxWidth`. Kumo dialogs are
 * 288px ("sm"), 384px ("base"), 512px ("lg") or wider ("xl").
 */
export function dialogSizeOf(
  maxWidth: number | string | undefined,
): KumoDialogSize {
  const pixels = pixelsOf(maxWidth);
  if (pixels === undefined) return "base";
  if (pixels <= 320) return "sm";
  if (pixels <= 448) return "base";
  if (pixels <= 600) return "lg";
  return "xl";
}

/** Copied from the standard Modal: a control, enabled or not. */
const CONTROL =
  'a[href],button,input,select,textarea,[role="button"],[tabindex]:not([tabindex="-1"])';
/** A click inside one of these never opens the dialog. */
const DISABLED = '[disabled],[aria-disabled="true"]';

/**
 * Modal: a Kumo Dialog. As in the standard Modal, a trigger that is not a
 * control itself (a Text) becomes a button, and a trigger that is a
 * control (a Button) keeps its own semantics, so buttons never nest.
 */
export function Modal(props: StandardProps<"Modal">) {
  const aria = useGenerativeUIAccessibility();
  const [ownOpen, setOwnOpen] = useState(false);
  const open = props.open ?? ownOpen;
  const setOpen = (value: boolean) => {
    setOwnOpen(value);
    props.setOpen(value);
  };
  const triggerRef = useRef<HTMLDivElement>(null);
  const [isPlainTrigger, setPlainTrigger] = useState(false);
  // The trigger can stream in after the Modal, so its DOM is observed.
  useEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const classify = () => {
      const isPlain = trigger.querySelector(CONTROL) === null;
      setPlainTrigger((current) => (current === isPlain ? current : isPlain));
    };
    classify();
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(classify);
    observer.observe(trigger, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  const CloseIcon = usePhosphorIcon("x");
  return (
    <>
      <div
        ref={triggerRef}
        role={isPlainTrigger ? "button" : undefined}
        tabIndex={isPlainTrigger ? 0 : undefined}
        aria-haspopup={isPlainTrigger ? "dialog" : undefined}
        aria-expanded={isPlainTrigger ? open : undefined}
        style={{
          display: "inline-flex",
          flexGrow: props.weight,
          cursor: isPlainTrigger ? "pointer" : undefined,
        }}
        onClickCapture={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest(DISABLED)) return;
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (!isPlainTrigger) return;
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        {props.trigger}
      </div>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog size={dialogSizeOf(props.maxWidth)}>
          <div
            {...aria}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "16px",
              padding: "24px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: "16px",
              }}
            >
              {props.title ? (
                <Dialog.Title className="text-lg font-semibold">
                  {props.title}
                </Dialog.Title>
              ) : (
                <span />
              )}
              <Dialog.Close
                aria-label="Close"
                render={(closeProps) => (
                  <KumoButton
                    {...closeProps}
                    variant="secondary"
                    shape="square"
                    size="sm"
                    aria-label="Close"
                    icon={
                      CloseIcon ? (
                        <CloseIcon size={14} aria-hidden />
                      ) : undefined
                    }
                  />
                )}
              />
            </div>
            <SurfaceScope>{props.content}</SurfaceScope>
          </div>
        </Dialog>
      </Dialog.Root>
    </>
  );
}

export const overlayOverrides = {
  Popover: { component: Popover },
  PopoverTrigger: { component: PopoverTrigger },
  PopoverContent: { component: PopoverContent },
  Modal: { component: Modal },
};
