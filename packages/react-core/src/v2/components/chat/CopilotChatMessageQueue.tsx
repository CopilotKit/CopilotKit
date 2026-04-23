import React, { useState, useRef, useEffect } from "react";
import type { InputContent } from "@copilotkit/shared";
import {
  ChevronUp,
  ChevronDown,
  X,
  Pencil,
  Paperclip,
  Check,
  ChevronsUpDown,
} from "lucide-react";
import { cn } from "../../lib/utils";
import type { QueuedMessage } from "../../hooks/use-message-queue";

export interface CopilotChatMessageQueueProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onEdit"> {
  messages: QueuedMessage[];
  onEdit: (id: string, content: InputContent[]) => void;
  onRemove: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  /**
   * Exposed for custom implementations that want a per-pill "send now" action.
   * Default UI does not render a per-pill send button — in manual mode the
   * main Send button drains the head.
   */
  onSendNow?: (id: string) => void;
  dispatch: "sequential" | "merged" | "manual";
  className?: string;
}

function textPreview(content: InputContent[]): string {
  const firstText = content.find((c) => c.type === "text");
  return firstText && "text" in firstText ? firstText.text : "";
}

function attachmentCount(content: InputContent[]): number {
  return content.filter((c) => c.type !== "text").length;
}

function replaceTextPart(
  content: InputContent[],
  newText: string,
): InputContent[] {
  const nonText = content.filter((c) => c.type !== "text");
  const next: InputContent[] = [];
  if (newText.length > 0) next.push({ type: "text", text: newText });
  next.push(...nonText);
  return next;
}

// ---------------------------------------------------------------------------
// IconButton — shared icon-only button used for pill controls.
// Muted by default, lights up on hover; keyboard-accessible focus ring.
// ---------------------------------------------------------------------------
interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: React.ReactNode;
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ label, children, className, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        className={cn(
          "cpk:inline-flex cpk:items-center cpk:justify-center cpk:p-0",
          "cpk:h-6 cpk:w-6 cpk:rounded-full cpk:bg-transparent cpk:border-0 cpk:cursor-pointer",
          "cpk:text-muted-foreground cpk:transition-colors",
          "cpk:hover:text-foreground cpk:hover:bg-accent",
          "cpk:disabled:opacity-30 cpk:disabled:pointer-events-none",
          "cpk:focus-visible:outline-none cpk:focus-visible:ring-2",
          "cpk:focus-visible:ring-ring cpk:focus-visible:ring-offset-1",
          "cpk:focus-visible:ring-offset-background",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

// ---------------------------------------------------------------------------
// Pill — single queued message row. Renders preview or inline editor.
// ---------------------------------------------------------------------------
interface QueuePillProps {
  item: QueuedMessage;
  isFirst: boolean;
  isLast: boolean;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onCommitEdit: (text: string) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

const QueuePill: React.FC<QueuePillProps> = ({
  item,
  isFirst,
  isLast,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onCommitEdit,
  onRemove,
  onMoveUp,
  onMoveDown,
}) => {
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing) {
      setDraft(textPreview(item.content));
      // Focus on the next tick so the textarea mounts first
      queueMicrotask(() => {
        textareaRef.current?.focus();
        textareaRef.current?.select();
      });
    }
  }, [isEditing, item.content]);

  const attachCount = attachmentCount(item.content);

  const containerBase =
    "cpk:flex cpk:items-center cpk:gap-1.5 cpk:px-3 cpk:border cpk:border-dashed cpk:border-muted-foreground/40 cpk:bg-background cpk:text-xs cpk:font-sans cpk:text-foreground cpk:transition-colors";
  const containerDefault =
    "cpk:min-h-8 cpk:rounded-full cpk:hover:bg-accent/40 cpk:hover:border-muted-foreground/60";
  const containerEditing =
    "cpk:py-1.5 cpk:rounded-2xl cpk:border-solid cpk:border-ring/70";

  if (isEditing) {
    return (
      <div className={cn(containerBase, containerEditing)}>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onCommitEdit(draft);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancelEdit();
            }
          }}
          className={cn(
            "cpk:flex-1 cpk:bg-transparent cpk:border-0 cpk:outline-0",
            "cpk:resize-none cpk:text-xs cpk:leading-5 cpk:text-foreground",
            "cpk:placeholder:text-muted-foreground",
            "cpk:font-sans",
          )}
          style={{ fontFamily: "inherit" }}
          rows={Math.min(4, Math.max(1, draft.split("\n").length))}
        />
        {attachCount > 0 && (
          <span
            className="cpk:flex cpk:items-center cpk:gap-0.5 cpk:text-muted-foreground cpk:shrink-0"
            aria-label={`${attachCount} attachment${attachCount === 1 ? "" : "s"}`}
          >
            <Paperclip className="cpk:h-3 cpk:w-3" aria-hidden="true" />
            <span className="cpk:text-[10px] cpk:leading-none">
              {attachCount}
            </span>
          </span>
        )}
        <div className="cpk:flex cpk:items-center cpk:gap-0.5 cpk:shrink-0 cpk:-mr-1">
          <IconButton
            label="Save edit"
            onClick={() => onCommitEdit(draft)}
          >
            <Check className="cpk:h-3.5 cpk:w-3.5" aria-hidden="true" />
          </IconButton>
          <IconButton label="Cancel edit" onClick={onCancelEdit}>
            <X className="cpk:h-3.5 cpk:w-3.5" aria-hidden="true" />
          </IconButton>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("group", containerBase, containerDefault)}>
      <span className="cpk:flex-1 cpk:min-w-0 cpk:truncate cpk:leading-none">
        {textPreview(item.content)}
      </span>

      {attachCount > 0 && (
        <span
          className="cpk:flex cpk:items-center cpk:gap-0.5 cpk:text-muted-foreground cpk:shrink-0"
          aria-label={`${attachCount} attachment${attachCount === 1 ? "" : "s"}`}
        >
          <Paperclip className="cpk:h-3 cpk:w-3" aria-hidden="true" />
          <span className="cpk:text-[10px] cpk:leading-none">
            {attachCount}
          </span>
        </span>
      )}

      <div className="cpk:flex cpk:items-center cpk:gap-0.5 cpk:shrink-0 cpk:-mr-1">
        <IconButton label="Move up" onClick={onMoveUp} disabled={isFirst}>
          <ChevronUp className="cpk:h-3.5 cpk:w-3.5" aria-hidden="true" />
        </IconButton>
        <IconButton label="Move down" onClick={onMoveDown} disabled={isLast}>
          <ChevronDown className="cpk:h-3.5 cpk:w-3.5" aria-hidden="true" />
        </IconButton>
        <IconButton label="Edit queued message" onClick={onStartEdit}>
          <Pencil className="cpk:h-3 cpk:w-3" aria-hidden="true" />
        </IconButton>
        <IconButton label="Remove queued message" onClick={onRemove}>
          <X className="cpk:h-3.5 cpk:w-3.5" aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// CopilotChatMessageQueue — queued messages rendered as pills above the input.
// ---------------------------------------------------------------------------
const COLLAPSE_THRESHOLD = 3;

export const CopilotChatMessageQueue: React.FC<
  CopilotChatMessageQueueProps
> = ({
  messages,
  onEdit,
  onRemove,
  onMoveUp,
  onMoveDown,
  onSendNow: _onSendNow,
  dispatch: _dispatch,
  className,
  ...rest
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  if (messages.length === 0) return null;

  const shouldCollapse =
    messages.length > COLLAPSE_THRESHOLD && !expanded;
  // When collapsed, show the head (first N) — those drain first in sequential
  // mode, so users care most about editing/removing them before they send.
  const visible = shouldCollapse
    ? messages.slice(0, COLLAPSE_THRESHOLD)
    : messages;
  const hiddenCount = messages.length - visible.length;

  return (
    <div
      data-copilotkit
      className={cn(
        "cpk:flex cpk:flex-col cpk:gap-1 cpk:px-2 cpk:pb-1",
        className,
      )}
      data-testid="copilot-chat-message-queue"
      {...rest}
    >
      {visible.map((item, idx) => (
        <QueuePill
          key={item.id}
          item={item}
          isFirst={idx === 0}
          isLast={idx === messages.length - 1}
          isEditing={editingId === item.id}
          onStartEdit={() => setEditingId(item.id)}
          onCancelEdit={() => setEditingId(null)}
          onCommitEdit={(text) => {
            onEdit(item.id, replaceTextPart(item.content, text));
            setEditingId(null);
          }}
          onRemove={() => onRemove(item.id)}
          onMoveUp={() => onMoveUp(item.id)}
          onMoveDown={() => onMoveDown(item.id)}
        />
      ))}
      {(shouldCollapse || expanded) && messages.length > COLLAPSE_THRESHOLD && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-label={
            expanded
              ? "Collapse queued messages"
              : `Show ${hiddenCount} more queued message${hiddenCount === 1 ? "" : "s"}`
          }
          aria-expanded={expanded}
          className={cn(
            "cpk:flex cpk:items-center cpk:justify-center cpk:gap-1.5",
            "cpk:self-center cpk:px-3 cpk:py-1 cpk:rounded-full",
            "cpk:text-[11px] cpk:font-medium cpk:text-muted-foreground",
            "cpk:bg-transparent cpk:border-0 cpk:cursor-pointer",
            "cpk:hover:text-foreground cpk:hover:bg-accent/60",
            "cpk:transition-colors",
            "cpk:focus-visible:outline-none cpk:focus-visible:ring-2",
            "cpk:focus-visible:ring-ring cpk:focus-visible:ring-offset-1",
            "cpk:focus-visible:ring-offset-background",
          )}
        >
          <ChevronsUpDown className="cpk:h-3 cpk:w-3" aria-hidden="true" />
          <span>
            {expanded
              ? "Show fewer"
              : `Show ${hiddenCount} more`}
          </span>
        </button>
      )}
    </div>
  );
};

export default CopilotChatMessageQueue;
