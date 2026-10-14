import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  CatalogRenderers,
  RendererProps,
} from "../../../../create-catalog";
import type { feedbackDefinitions } from "../definitions/feedback";
import { renderChildren } from "./layout";
import {
  backgroundColor,
  borderColor,
  radius,
  spacing,
  textColor,
  textFont,
} from "../tokens";

const STYLE_ID = "a2ui-standard-feedback";
const KEYFRAMES = [
  "@keyframes a2ui-spin{to{transform:rotate(360deg)}}",
  "@keyframes a2ui-pulse{0%{transform:scale(1);opacity:.6}100%{transform:scale(2.4);opacity:0}}",
  "@keyframes a2ui-block-shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}",
  "@keyframes a2ui-confetti{0%{transform:translate(0,0) rotate(0);opacity:1}100%{transform:translate(var(--a2ui-dx),var(--a2ui-dy)) rotate(var(--a2ui-rot));opacity:0}}",
].join("");

/** Inject the feedback keyframes once per document. */
function useFeedbackKeyframes() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = KEYFRAMES;
    document.head.appendChild(style);
  }, []);
}

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));

const SPINNER_PX: Record<string, number> = { sm: 14, md: 20, lg: 28 };

function Spinner({ size, color }: { size?: string; color?: string }) {
  useFeedbackKeyframes();
  const px = SPINNER_PX[size ?? "md"] ?? SPINNER_PX.md;
  return (
    <span
      role="progressbar"
      aria-busy
      style={{
        display: "inline-block",
        flex: "none",
        width: px,
        height: px,
        boxSizing: "border-box",
        borderRadius: "9999px",
        border: `2px solid ${borderColor("default")}`,
        borderTopColor: textColor(color ?? "prose"),
        animation: "a2ui-spin 0.8s linear infinite",
      }}
    />
  );
}

const CONFETTI = ["🎉", "✨", "🎊", "⭐", "💫", "🥳"];
const PARTICLES = 24;

function Celebration({ props, children }: RendererProps<any>) {
  useFeedbackKeyframes();
  const [burst, setBurst] = useState(0);
  const trigger = str(props.trigger);
  useEffect(() => {
    setBurst((b) => b + 1);
    const t = setTimeout(() => setBurst(0), 1200);
    return () => clearTimeout(t);
  }, [trigger]);
  return (
    <div
      style={{ position: "relative", display: "flex", flexDirection: "column" }}
    >
      {renderChildren(props.children, children)}
      {burst > 0 ? (
        <div
          key={burst}
          aria-hidden
          data-a2ui-celebration=""
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            overflow: "visible",
          }}
        >
          {Array.from({ length: PARTICLES }, (_, i) => {
            const angle = (i / PARTICLES) * Math.PI * 2;
            const dist = 60 + (i % 4) * 20;
            return (
              <span
                key={i}
                style={
                  {
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    fontSize: 14,
                    "--a2ui-dx": `${Math.round(Math.cos(angle) * dist)}px`,
                    "--a2ui-dy": `${Math.round(Math.sin(angle) * dist)}px`,
                    "--a2ui-rot": `${(i * 47) % 360}deg`,
                    animation: "a2ui-confetti 1.2s ease-out forwards",
                  } as React.CSSProperties
                }
              >
                {CONFETTI[i % CONFETTI.length]}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function FlashcardFlip({ props }: RendererProps<any>) {
  const [flipped, setFlipped] = useState(false);
  return (
    <button
      type="button"
      aria-pressed={flipped}
      onClick={() => setFlipped((f) => !f)}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: spacing(2),
        minHeight: 140,
        width: "100%",
        padding: spacing(5),
        boxSizing: "border-box",
        fontFamily: "inherit",
        cursor: "pointer",
        border: `1px solid ${borderColor("default")}`,
        borderRadius: radius("xl"),
        background: backgroundColor(flipped ? "surface-secondary" : "surface"),
        color: textColor("default"),
      }}
    >
      <span style={{ ...textFont("lg"), fontWeight: 600 }}>
        {str(flipped ? props.back : props.front)}
      </span>
      {props.hint && !flipped ? (
        <span style={{ ...textFont("sm"), color: textColor("tertiary") }}>
          {props.hint}
        </span>
      ) : null}
    </button>
  );
}

interface PopoverState {
  open: boolean;
  toggle: () => void;
}
const PopoverContext = createContext<PopoverState | null>(null);

function Popover({ props, children }: RendererProps<any>) {
  const bound = typeof props.open === "boolean";
  const [localOpen, setLocalOpen] = useState(false);
  const open = bound ? (props.open as boolean) : localOpen;
  const setOpen = (next: boolean) => {
    setLocalOpen(next);
    props.setOpen?.(next);
  };
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setLocalOpen(false);
        props.setOpen?.(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <PopoverContext.Provider value={{ open, toggle: () => setOpen(!open) }}>
      <div
        ref={rootRef}
        style={{ position: "relative", display: "inline-flex" }}
        onMouseEnter={props.showOnHover ? () => setOpen(true) : undefined}
        onMouseLeave={props.showOnHover ? () => setOpen(false) : undefined}
      >
        {renderChildren(props.children, children)}
      </div>
    </PopoverContext.Provider>
  );
}

function PopoverTrigger({ props, children }: RendererProps<any>) {
  const ctx = useContext(PopoverContext);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={ctx?.open ?? false}
      onClick={() => ctx?.toggle()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          ctx?.toggle();
        }
      }}
      style={{ display: "inline-flex", cursor: "pointer" }}
    >
      {renderChildren(props.children, children)}
    </div>
  );
}

const SIDE_STYLE: Record<string, React.CSSProperties> = {
  bottom: { top: "100%", marginTop: 6 },
  top: { bottom: "100%", marginBottom: 6 },
  left: { right: "100%", marginRight: 6 },
  right: { left: "100%", marginLeft: 6 },
};

function alignStyle(side: string, align: string): React.CSSProperties {
  const vertical = side === "top" || side === "bottom";
  if (vertical) {
    if (align === "end") return { right: 0 };
    if (align === "center")
      return { left: "50%", transform: "translateX(-50%)" };
    return { left: 0 };
  }
  if (align === "end") return { bottom: 0 };
  if (align === "center") return { top: "50%", transform: "translateY(-50%)" };
  return { top: 0 };
}

function PopoverContent({ props, children }: RendererProps<any>) {
  const ctx = useContext(PopoverContext);
  if (ctx && !ctx.open) return null;
  const side: string = props.side ?? "bottom";
  return (
    <div
      role="dialog"
      style={{
        position: ctx ? "absolute" : "relative",
        zIndex: 50,
        ...(ctx ? (SIDE_STYLE[side] ?? SIDE_STYLE.bottom) : {}),
        ...(ctx ? alignStyle(side, props.align ?? "center") : {}),
        width: spacing(props.width),
        minWidth: 160,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: spacing(2),
        padding: spacing(3),
        background: backgroundColor("surface-elevated"),
        border: `1px solid ${borderColor("default")}`,
        borderRadius: radius("lg"),
        boxShadow: "0 4px 16px rgba(0,0,0,.12)",
      }}
    >
      {renderChildren(props.children, children)}
    </div>
  );
}

function LoadingBlock({ props }: RendererProps<any>) {
  useFeedbackKeyframes();
  const base = backgroundColor(props.background ?? "surface-tertiary");
  return (
    <div
      role="status"
      aria-busy
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 64,
        width: "100%",
        borderRadius: radius("lg"),
        backgroundColor: base,
        backgroundImage:
          "linear-gradient(90deg, transparent 0%, rgba(255,255,255,.55) 50%, transparent 100%)",
        backgroundSize: "200% 100%",
        animation: `a2ui-block-shimmer ${props.duration ?? 1500}ms linear infinite`,
        ...textFont("sm"),
        color: textColor("secondary"),
      }}
    >
      {props.label ? str(props.label) : null}
    </div>
  );
}

function PulseIndicator({ props }: RendererProps<any>) {
  useFeedbackKeyframes();
  const size: number = props.size ?? 12;
  const color = textColor(props.color ?? "success");
  return (
    <span
      role="status"
      aria-label="Live"
      style={{
        position: "relative",
        display: "inline-block",
        width: size,
        height: size,
        flex: "none",
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "9999px",
          background: textColor(props.pulseColor) ?? color,
          animation: `a2ui-pulse ${props.duration ?? 1500}ms ease-out infinite`,
        }}
      />
      <span
        aria-hidden
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

export const feedbackRenderers = {
  Loading: ({ props }: RendererProps<any>) => (
    <div
      role="status"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: spacing(2),
        ...textFont(props.size === "lg" ? "md" : "sm"),
        color: textColor("secondary"),
      }}
    >
      <Spinner size={props.size} />
      <span>{props.label ?? "Loading"}</span>
    </div>
  ),
  LoadingIndicator: ({ props }: RendererProps<any>) => (
    <Spinner size={props.size} color={props.color} />
  ),
  LoadingBlock,
  PulseIndicator,
  Celebration,
  FlashcardFlip,
  Popover,
  PopoverTrigger,
  PopoverContent,
} satisfies CatalogRenderers<typeof feedbackDefinitions>;
