import { useLayoutEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Bookmark } from "lucide-react";
import {
  CopilotChatDefaultLabels,
  useCopilotChatConfiguration,
} from "../../providers/CopilotChatConfigurationProvider";
import { Button } from "../../components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip";
import {
  SAVE_SNIPPET_BESIDE_BODY_CLASS,
  SAVE_SNIPPET_BESIDE_SAVE_CLASS,
  SAVE_SNIPPET_BESIDE_WRAP_CLASS,
  findOverflowAncestor,
  measureSaveSnippetSide,
  saveSnippetBesideStyle,
} from "./save-snippet-beside";

export function SaveSnippetIconButton({
  title,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const config = useCopilotChatConfiguration();
  const labels = config?.labels ?? CopilotChatDefaultLabels;
  const primaryLabel = title || labels.assistantMessageToolbarSaveSnippetLabel;
  const localOnlyLabel = labels.assistantMessageToolbarInspectorLocalOnlyLabel;
  const accessibleLabel = `${primaryLabel} (${localOnlyLabel})`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="assistantMessageToolbarButton"
          aria-label={accessibleLabel}
          title={accessibleLabel}
          className={className}
          {...props}
        >
          <Bookmark className="cpk:size-[18px]" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <div className="cpk:flex cpk:flex-col cpk:gap-0.5">
          <span>{primaryLabel}</span>
          <span className="cpk:text-[10px] cpk:opacity-65">
            {localOnlyLabel}
          </span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function SaveSnippetBesideChrome({
  children,
  showSave,
  saveButton,
}: {
  children: ReactNode;
  showSave: boolean;
  saveButton: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState<"left" | "right">("right");

  useLayoutEffect(() => {
    if (!showSave) {
      return;
    }
    const wrap = wrapRef.current;
    const body = bodyRef.current;
    if (!wrap || !body) {
      return;
    }

    const measure = () => {
      setSide(measureSaveSnippetSide(wrap, body));
    };

    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    observer.observe(body);
    const clip = findOverflowAncestor(wrap);
    if (clip !== wrap) {
      observer.observe(clip);
    }
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [showSave]);

  if (!showSave) {
    return children;
  }

  return (
    <div
      ref={wrapRef}
      className={SAVE_SNIPPET_BESIDE_WRAP_CLASS}
      data-save-snippet-side={side}
    >
      <div ref={bodyRef} className={SAVE_SNIPPET_BESIDE_BODY_CLASS}>
        {children}
      </div>
      <div
        className={SAVE_SNIPPET_BESIDE_SAVE_CLASS}
        style={saveSnippetBesideStyle(side)}
      >
        {saveButton}
      </div>
    </div>
  );
}
