import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, KeyboardEvent, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { z } from "zod";
import {
  controlAria,
  useGenerativeUIAccessibility,
  wrapperAria,
} from "../accessibility";
import { useGenerativeUIRuntime } from "../runtime-context";
import { useOverlayEscape } from "./overlay-stack";
import { CHILDREN_SLOT, sizeValue, weightProp } from "./layout";
import { useStandardStyles } from "./styles";
import {
  BACKDROP,
  backgroundColor,
  borderColor,
  radius,
  spacing,
  textColor,
  textFont,
  SHADOW_MD,
} from "./tokens";

// ---- Styles ----

export const FEEDBACK_STYLE_ID = "a2ui-standard-feedback";

/**
 * The keyframes of the feedback components, and the rules for reduced
 * motion. Reduced is not none: the pulse ring keeps fading but no longer
 * grows (`data-a2ui-pulse`; `!important`, because the ring sets its
 * animation inline), because a status that does not move says nothing. The confetti layer
 * (`data-a2ui-celebration`) is hidden, because still confetti has no
 * meaning. An element that moves has `data-a2ui-motion`.
 */
export const FEEDBACK_CSS = [
  "@keyframes a2ui-pulse{0%{transform:scale(1);opacity:var(--a2ui-pulse-opacity,.6)}100%{transform:scale(var(--a2ui-pulse-scale,2.4));opacity:0}}",
  "@keyframes a2ui-pulse-fade{0%{opacity:var(--a2ui-pulse-opacity,.6)}100%{opacity:0}}",
  "@keyframes a2ui-confetti{0%{transform:translate(0,0) rotate(0);opacity:1}100%{transform:translate(var(--a2ui-dx),var(--a2ui-dy)) rotate(var(--a2ui-rot));opacity:0}}",
  "[data-a2ui-feedback-button]:focus-visible{outline:2px solid var(--a2ui-color-focus, #0285ff);outline-offset:2px}",
  "@media (prefers-reduced-motion: reduce){[data-a2ui-pulse]{animation-name:a2ui-pulse-fade !important}[data-a2ui-celebration]{display:none}}",
].join("\n");

// There is no document on the server, so nothing is added there.
const noEffect: typeof React.useInsertionEffect = () => {};
const useInjectEffect =
  typeof document === "undefined" ? noEffect : React.useInsertionEffect;

/** Adds the standard stylesheet and the feedback stylesheet, once each. */
function useFeedbackStyles() {
  useStandardStyles();
  useInjectEffect(() => {
    if (document.getElementById(FEEDBACK_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = FEEDBACK_STYLE_ID;
    style.textContent = FEEDBACK_CSS;
    document.head.appendChild(style);
  }, []);
}

/** A native button without the browser look. */
const BUTTON_RESET: CSSProperties = {
  margin: 0,
  padding: 0,
  border: 0,
  background: "none",
  font: "inherit",
  color: "inherit",
  textAlign: "inherit",
  cursor: "pointer",
};

// ---- Schemas ----

const pulseIndicatorSchema = z.object({
  label: z
    .string()
    .optional()
    .describe(
      "What the dot means, for screen readers. Leave it unset when text next to the dot says the same",
    ),
  color: z.string().optional().describe('Text color token. Default "success"'),
  size: z.number().optional().describe("Pixels. Default 12"),
  pulseColor: z.string().optional(),
  duration: z.number().optional().describe("Milliseconds. Default 1500"),
  endScale: z.number().optional().describe("Default 2.4"),
  startOpacity: z.number().optional().describe("Default 0.6"),
});
const celebrationSchema = z.object({
  trigger: z
    .string()
    .optional()
    .describe("Each new value plays the confetti again"),
});
const flashcardSchema = z.object({
  front: z.string().optional().describe("The text on the front"),
  back: z.string().optional().describe("The text on the back"),
  hint: z
    .string()
    .optional()
    .describe('A small line under the front, for example "Click to flip"'),
});
const popoverSchema = z.object({
  open: z.boolean().optional().describe("Default false"),
  showOnHover: z.boolean().optional(),
  hoverOpenDelay: z
    .number()
    .optional()
    .describe("Milliseconds before a hover opens it. Default 0"),
});
const popoverTriggerSchema = z.object({
  block: z.boolean().optional().describe("Full width"),
});
const popoverContentSchema = z.object({
  side: z
    .enum(["top", "bottom", "left", "right"])
    .optional()
    .describe('Default "bottom"'),
  sideOffset: z
    .number()
    .optional()
    .describe("Pixels between the trigger and the content. Default 6"),
  align: z
    .enum(["start", "center", "end"])
    .optional()
    .describe('Default "center"'),
  width: sizeValue.optional().describe("4px steps when a number"),
});

type WithChildren<Props> = Props & { children?: ReactNode };
type PulseIndicatorProps = z.output<typeof pulseIndicatorSchema>;
type CelebrationProps = WithChildren<z.output<typeof celebrationSchema>>;
type FlashcardProps = z.output<typeof flashcardSchema>;
type PopoverProps = WithChildren<
  z.output<typeof popoverSchema> & { setOpen: (value: boolean) => void }
>;
type PopoverTriggerProps = WithChildren<z.output<typeof popoverTriggerSchema>>;
type PopoverContentProps = WithChildren<z.output<typeof popoverContentSchema>>;

// ---- Status ----

/** A spinning ring. It is decoration: the caller names the status. */
function PulseIndicator(props: PulseIndicatorProps) {
  useFeedbackStyles();
  const size = props.size ?? 12;
  const color = textColor(props.color ?? "success");
  const hasLabel = props.label !== undefined;
  return (
    <span
      role={hasLabel ? "img" : undefined}
      aria-label={props.label}
      aria-hidden={hasLabel ? undefined : "true"}
      data-a2ui-std=""
      style={{
        position: "relative",
        display: "inline-block",
        width: size,
        height: size,
        flex: "none",
      }}
    >
      <span
        data-a2ui-motion=""
        data-a2ui-pulse=""
        style={
          {
            position: "absolute",
            inset: 0,
            borderRadius: "9999px",
            background: textColor(props.pulseColor) ?? color,
            animation: `a2ui-pulse ${props.duration ?? 1500}ms ease-out infinite`,
            "--a2ui-pulse-scale": props.endScale,
            "--a2ui-pulse-opacity": props.startOpacity,
          } as CSSProperties
        }
      />
      <span
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "9999px",
          background: color,
        }}
      />
    </span>
  );
}

// ---- Celebration ----

const CONFETTI = ["🎉", "✨", "🎊", "⭐", "💫", "🥳"];
const PARTICLES = 24;
/** How long one confetti burst plays, in milliseconds. */
export const CELEBRATION_MS = 1200;

/** The CSS of one confetti particle, spread on a circle around the center. */
function particleStyle(index: number) {
  const angle = (index / PARTICLES) * Math.PI * 2;
  const distance = 60 + (index % 4) * 20;
  const style: CSSProperties & Record<`--a2ui-${string}`, string> = {
    position: "absolute",
    left: "50%",
    top: "50%",
    fontSize: 14,
    "--a2ui-dx": `${Math.round(Math.cos(angle) * distance)}px`,
    "--a2ui-dy": `${Math.round(Math.sin(angle) * distance)}px`,
    "--a2ui-rot": `${(index * 47) % 360}deg`,
    animation: `a2ui-confetti ${CELEBRATION_MS}ms ease-out forwards`,
  };
  return style;
}

function Celebration(props: CelebrationProps) {
  useFeedbackStyles();
  const [burst, setBurst] = useState(0);
  useEffect(() => {
    setBurst((count) => count + 1);
    const timer = setTimeout(() => setBurst(0), CELEBRATION_MS);
    return () => clearTimeout(timer);
  }, [props.trigger]);
  const particles = Array.from({ length: PARTICLES }, (_, index) => index);
  return (
    <div
      data-a2ui-std=""
      style={{ position: "relative", display: "flex", flexDirection: "column" }}
    >
      {props.children}
      {burst > 0 ? (
        <div
          key={burst}
          aria-hidden="true"
          data-a2ui-celebration=""
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            overflow: "visible",
          }}
        >
          {particles.map((index) => (
            <span key={index} data-a2ui-motion="" style={particleStyle(index)}>
              {CONFETTI[index % CONFETTI.length]}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---- FlashcardFlip ----

/**
 * A native toggle button. Click, Enter and Space flip it, and
 * `aria-pressed` tells a screen reader which side shows.
 */
function FlashcardFlip(props: FlashcardProps) {
  useFeedbackStyles();
  const [flipped, setFlipped] = useState(false);
  const showsHint = props.hint !== undefined && !flipped;
  return (
    <button
      type="button"
      aria-pressed={flipped}
      data-a2ui-std=""
      data-a2ui-feedback-button=""
      onClick={() => setFlipped((current) => !current)}
      style={{
        ...BUTTON_RESET,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: spacing(2),
        minHeight: 140,
        width: "100%",
        padding: spacing(5),
        boxSizing: "border-box",
        textAlign: "center",
        border: `1px solid ${borderColor("default")}`,
        borderRadius: radius("xl"),
        background: backgroundColor(flipped ? "surface-secondary" : "surface"),
        color: textColor("default"),
      }}
    >
      <span style={{ ...textFont("lg"), fontWeight: 600 }}>
        {flipped ? props.back : props.front}
      </span>
      {showsHint ? (
        <span style={{ ...textFont("sm"), color: textColor("tertiary") }}>
          {props.hint}
        </span>
      ) : null}
    </button>
  );
}

// ---- Popover ----

interface PopoverState {
  open: boolean;
  setOpen: (value: boolean) => void;
  triggerId: string;
  contentId: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

const PopoverContext = createContext<PopoverState | null>(null);

/**
 * A non-modal overlay. It does not trap focus. Escape closes it and moves
 * focus back to the trigger. A pointer press outside of it closes it.
 * `open` is writable, so a `{ "@path" }` binding keeps the open state in the
 * data model.
 */
function Popover(props: PopoverProps) {
  useFeedbackStyles();
  const { setOpen } = props;
  const open = props.open ?? false;
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openOnHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    const delay = props.hoverOpenDelay ?? 0;
    if (delay > 0) hoverTimer.current = setTimeout(() => setOpen(true), delay);
    else setOpen(true);
  };
  const closeOnLeave = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setOpen(false);
  };
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      const isOutside =
        root !== null &&
        event.target instanceof Node &&
        !root.contains(event.target);
      if (isOutside) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, setOpen]);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !open) return;
    // Escape closes only the topmost overlay.
    event.stopPropagation();
    setOpen(false);
    triggerRef.current?.focus();
  };
  return (
    <PopoverContext.Provider
      value={{
        open,
        setOpen,
        triggerId: `${id}-trigger`,
        contentId: `${id}-content`,
        triggerRef,
      }}
    >
      <div
        ref={rootRef}
        data-a2ui-std=""
        onKeyDown={onKeyDown}
        onMouseEnter={props.showOnHover ? openOnHover : undefined}
        onMouseLeave={props.showOnHover ? closeOnLeave : undefined}
        style={{ position: "relative", display: "inline-flex" }}
      >
        {props.children}
      </div>
    </PopoverContext.Provider>
  );
}

function PopoverTrigger(props: PopoverTriggerProps) {
  const aria = useGenerativeUIAccessibility();
  useFeedbackStyles();
  const popover = useContext(PopoverContext);
  if (!popover) return <>{props.children}</>;
  return (
    <button
      {...controlAria(aria)}
      ref={popover.triggerRef}
      type="button"
      id={popover.triggerId}
      aria-haspopup="dialog"
      aria-expanded={popover.open}
      aria-controls={popover.open ? popover.contentId : undefined}
      data-a2ui-std=""
      data-a2ui-feedback-button=""
      data-a2ui-popover-trigger=""
      // The capture phase: a Button child stops the propagation of its own
      // click (so it never bubbles into a Pressable), which would leave the
      // trigger without the click.
      onClickCapture={() => popover.setOpen(!popover.open)}
      style={{
        ...BUTTON_RESET,
        display: props.block ? "flex" : "inline-flex",
        width: props.block ? "100%" : undefined,
        alignItems: "center",
        minWidth: 24,
        minHeight: 24,
        borderRadius: radius("xs"),
      }}
    >
      {props.children}
    </button>
  );
}

type Side = NonNullable<PopoverContentProps["side"]>;
type Align = NonNullable<PopoverContentProps["align"]>;

/** Where the content sits: on `side` of the trigger, `offset` pixels away. */
function sideStyle(side: Side, offset: number): CSSProperties {
  switch (side) {
    case "bottom":
      return { top: "100%", marginTop: offset };
    case "top":
      return { bottom: "100%", marginBottom: offset };
    case "left":
      return { right: "100%", marginRight: offset };
    case "right":
      return { left: "100%", marginLeft: offset };
  }
}

/** Where the content sits along the side of the trigger. */
function alignStyle(side: Side, align: Align) {
  const isVertical = side === "top" || side === "bottom";
  switch (align) {
    case "start":
      return isVertical ? { left: 0 } : { top: 0 };
    case "end":
      return isVertical ? { right: 0 } : { bottom: 0 };
    case "center":
      return isVertical
        ? { left: "50%", transform: "translateX(-50%)" }
        : { top: "50%", transform: "translateY(-50%)" };
  }
}

const PANEL_STYLE: CSSProperties = {
  zIndex: 50,
  minWidth: 160,
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  gap: spacing(2),
  padding: spacing(3),
  background: backgroundColor("surface-elevated"),
  border: `1px solid ${borderColor("default")}`,
  borderRadius: radius("lg"),
  boxShadow: SHADOW_MD,
};

/**
 * The body of a Popover, shown only when the Popover is open. Outside of a
 * Popover, it is a plain panel that always shows.
 */
function PopoverContent(props: PopoverContentProps) {
  useFeedbackStyles();
  const popover = useContext(PopoverContext);
  if (!popover) {
    return (
      <div
        data-a2ui-std=""
        style={{
          ...PANEL_STYLE,
          position: "relative",
          width: spacing(props.width),
        }}
      >
        {props.children}
      </div>
    );
  }
  if (!popover.open) return null;
  const side = props.side ?? "bottom";
  return (
    <div
      role="dialog"
      id={popover.contentId}
      aria-labelledby={popover.triggerId}
      data-a2ui-std=""
      style={{
        ...PANEL_STYLE,
        position: "absolute",
        ...sideStyle(side, props.sideOffset ?? 6),
        ...alignStyle(side, props.align ?? "center"),
        width: spacing(props.width),
      }}
    >
      {props.children}
    </div>
  );
}

const modalSchema = z.object({
  title: z.string().optional().describe("The heading of the dialog"),
  open: z
    .boolean()
    .optional()
    .describe('Default false. Bind it with { "@path": "/x" } to read it'),
  maxWidth: sizeValue.optional().describe("Default 480"),
  weight: weightProp,
});

type ModalProps = z.output<typeof modalSchema> & {
  trigger?: ReactNode;
  content?: ReactNode;
  setOpen?: (open: boolean) => void;
};

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),iframe,video[controls],audio[controls],[tabindex]:not([tabindex="-1"])';
/**
 * A control, enabled or not: a disabled Button, or a Pressable (a div with
 * the button role) is still the trigger, and the wrapper must not open the
 * dialog in its place.
 */
const CONTROL =
  'a[href],button,input,select,textarea,[role="button"],[tabindex]:not([tabindex="-1"])';
/** A click inside one of these never opens the dialog. */
const DISABLED = '[disabled],[aria-disabled="true"]';

/**
 * A modal dialog. The trigger is wrapped in a button when it is not one
 * itself (a click anywhere on it opens the dialog). While open, Tab cycles
 * inside the dialog, Escape closes it, and the focus returns to the trigger.
 */
function Modal(props: ModalProps) {
  useFeedbackStyles();
  // The dialog is a portal, outside the wrapper the engine puts around the
  // component, so it takes the envelope itself.
  const aria = useGenerativeUIAccessibility();
  const id = useId();
  const [ownOpen, setOwnOpen] = useState(false);
  const open = props.open ?? ownOpen;
  const setOpen = (value: boolean) => {
    setOwnOpen(value);
    props.setOpen?.(value);
  };
  const triggerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // A stable close for the overlay stack, so a re-render of this Modal does
  // not move it above an overlay that opened later.
  const closeRef = useRef(() => setOpen(false));
  closeRef.current = () => setOpen(false);
  const close = useCallback(() => closeRef.current(), []);
  useOverlayEscape(open, close);
  // A trigger that is not a control itself (a Text) gets the button role
  // and a tab stop, so the keyboard can open the dialog. A Button inside
  // keeps its own semantics: nesting buttons is invalid.
  const [isPlainTrigger, setPlainTrigger] = useState(false);
  // The trigger component can stream in after the Modal, which re-renders
  // the slot but not the Modal. So the DOM of the trigger is observed, and
  // the classification follows what is rendered in it.
  useEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const classify = () => {
      // A disabled control is still a control: the wrapper must not open
      // the dialog in its place.
      const isPlain = trigger.querySelector(CONTROL) === null;
      setPlainTrigger((current) => (current === isPlain ? current : isPlain));
    };
    classify();
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(classify);
    observer.observe(trigger, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  // The dialog is portaled out of the surface, so it takes the theme
  // variables and the surface style scope with it.
  const theme = useGenerativeUIRuntime()?.theme;
  const portalStyle = useMemo((): CSSProperties => {
    const { mapStyle: _mapStyle, ...variables } = theme ?? {};
    return { display: "contents", ...(variables as CSSProperties) };
  }, [theme]);
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const previous = document.activeElement;
    const focusables = () =>
      Array.from(dialog?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    (focusables()[0] ?? dialog)?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => {
      // Escape is handled by the overlay stack: only the newest overlay.
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previous instanceof HTMLElement) previous.focus();
      else triggerRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    };
    // setOpen is recreated each render; the effect only needs `open`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <>
      <div
        ref={triggerRef}
        data-a2ui-std=""
        data-a2ui-modal-trigger=""
        role={isPlainTrigger ? "button" : undefined}
        tabIndex={isPlainTrigger ? 0 : undefined}
        aria-haspopup={isPlainTrigger ? "dialog" : undefined}
        aria-expanded={isPlainTrigger ? open : undefined}
        style={{
          display: "inline-flex",
          flexGrow: props.weight,
          cursor: isPlainTrigger ? "pointer" : undefined,
        }}
        // The capture phase sees the click before a Button inside handles
        // it, and lets it through: the Button still sends its own event,
        // opens its href or copies its text.
        onClickCapture={(event) => {
          // A disabled control inside the trigger (a Pressable, a Button)
          // keeps the dialog closed, also before its own click handler.
          const target = event.target as Element | null;
          const control = target?.closest(CONTROL);
          if (control && triggerRef.current?.contains(control)) {
            if (control.matches(DISABLED)) return;
          }
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (!isPlainTrigger) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {props.trigger}
      </div>
      {open && typeof document !== "undefined"
        ? // A portal: a fixed backdrop inside a transformed chat row would be
          // clipped to the row. The Lightbox does the same.
          createPortal(
            <div className="a2ui-surface" style={portalStyle}>
              <div
                data-a2ui-modal-backdrop=""
                onClick={() => setOpen(false)}
                style={{
                  position: "fixed",
                  inset: 0,
                  zIndex: 1000,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: spacing(4),
                  background: BACKDROP,
                }}
              >
                <div
                  ref={dialogRef}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby={
                    props.title && aria["aria-label"] === undefined
                      ? `${id}-title`
                      : undefined
                  }
                  aria-label={aria["aria-label"]}
                  aria-description={aria["aria-description"]}
                  {...wrapperAria(aria)}
                  tabIndex={-1}
                  onClick={(event) => event.stopPropagation()}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: spacing(3),
                    width: "100%",
                    maxWidth: spacing(props.maxWidth ?? 480),
                    maxHeight: "90vh",
                    overflow: "auto",
                    padding: spacing(5),
                    borderRadius: radius("xl"),
                    background: backgroundColor("surface"),
                    color: textColor("default"),
                    boxShadow: SHADOW_MD,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: spacing(3),
                    }}
                  >
                    {props.title ? (
                      <h2
                        id={`${id}-title`}
                        style={{
                          margin: 0,
                          fontSize: "1.125em",
                          fontWeight: 600,
                        }}
                      >
                        {props.title}
                      </h2>
                    ) : (
                      <span />
                    )}
                    <button
                      type="button"
                      aria-label="Close"
                      data-a2ui-input=""
                      onClick={() => setOpen(false)}
                      style={{
                        width: 32,
                        height: 32,
                        border: "none",
                        borderRadius: radius("full"),
                        background: "transparent",
                        color: textColor("secondary"),
                        fontSize: 20,
                        lineHeight: 1,
                        cursor: "pointer",
                      }}
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </div>
                  {props.content}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/**
 * The standard feedback components: loading states, a pulse dot, a
 * confetti burst, a flashcard and a popover. Give them to
 * `createGenerativeUI({ components: { ...feedbackComponents } })`.
 *
 * Celebration, Popover, PopoverTrigger and PopoverContent have a
 * "multiple" `children` slot. Popover `open` is writable, so the component
 * gets a `setOpen` prop.
 */
export const feedbackComponents = {
  PulseIndicator: {
    component: PulseIndicator,
    description:
      'A small dot that pulses, for example next to the text "Live". Set label when no text next to the dot says what it means.',
    props: pulseIndicatorSchema,
  },
  Celebration: {
    component: Celebration,
    description:
      "Shows its children and plays a confetti burst over them when it appears. Set trigger to a new value to play the burst again.",
    props: celebrationSchema,
    slots: CHILDREN_SLOT,
  },
  FlashcardFlip: {
    component: FlashcardFlip,
    description:
      "A card that shows the front text. A click or the Enter key flips it to the back text, and again to the front.",
    props: flashcardSchema,
  },
  Popover: {
    component: Popover,
    description:
      "A small overlay next to a trigger. Put exactly two children in it: one PopoverTrigger, then one PopoverContent. A click on the trigger opens and closes the content. Escape or a click outside closes it.",
    props: popoverSchema,
    slots: CHILDREN_SLOT,
    writable: ["open"] as const,
  },
  PopoverTrigger: {
    component: PopoverTrigger,
    description:
      "The trigger of a Popover. Its children are the label of the trigger: a Text or an Icon. Do not put a Button in it, because the trigger is already a button.",
    props: popoverTriggerSchema,
    slots: CHILDREN_SLOT,
  },
  PopoverContent: {
    component: PopoverContent,
    description:
      "The body of a Popover. It shows only when the Popover is open.",
    props: popoverContentSchema,
    slots: CHILDREN_SLOT,
  },
  Modal: {
    component: Modal,
    description:
      "A dialog over the page. A click on the trigger (a Button or a Text) opens the content in the dialog. Escape, the close button or a click on the backdrop closes it.",
    props: modalSchema,
    slots: { trigger: "single", content: "single" } as const,
    writable: ["open"] as const,
  },
};
