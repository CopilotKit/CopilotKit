"use client";

import { Fragment, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";

/**
 * Renders the A2UI v0.8 components that the agent sends with
 * `render_daily_brief`. CopilotKit's generative UI renders A2UI 1.0 and does
 * not take v0.8, so this app renders the component types that the agent's
 * prompt allows (`agent/src/a2ui_agentspec_agent.py`): Card, Column, Row,
 * Text, Icon, Divider and Modal. Values are `{ "literalString": ... }` or a
 * `{ "path": "/key" }` binding into `data`.
 *
 * The class names (`a2ui-card`, `a2ui-modal`, ...) are the ones that
 * `.canvas-a2ui` in `src/app/style.css` styles.
 */

type V08Value = {
  path?: string;
  literalString?: string;
  literalNumber?: number;
  literalBoolean?: boolean;
};

type V08Children = { explicitList?: string[] };

type V08Props = {
  child?: string;
  children?: V08Children;
  alignment?: string;
  distribution?: string;
  text?: V08Value;
  usageHint?: string;
  name?: V08Value;
  entryPointChild?: string;
  contentChild?: string;
};

export type A2UIV08Component = {
  id: string;
  weight?: number;
  component: Record<string, V08Props>;
};

type RenderContext = {
  components: Map<string, A2UIV08Component>;
  data: Record<string, unknown>;
};

const FLEX_ALIGN: Record<string, CSSProperties["alignItems"]> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
};

const FLEX_JUSTIFY: Record<string, CSSProperties["justifyContent"]> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  spaceBetween: "space-between",
  spaceAround: "space-around",
  spaceEvenly: "space-evenly",
};

function readPath(data: unknown, path: string): unknown {
  return path
    .split("/")
    .filter(Boolean)
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[key]
          : undefined,
      data,
    );
}

function resolveText(value: V08Value | undefined, data: unknown): string {
  if (!value) return "";
  if (typeof value.path === "string") {
    const bound = readPath(data, value.path);
    return bound === undefined || bound === null ? "" : String(bound);
  }
  return String(
    value.literalString ?? value.literalNumber ?? value.literalBoolean ?? "",
  );
}

/** `**bold**` and `*italic*`, the markdown the agent's captions use. */
function renderInlineMarkdown(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

/** Material Symbols ligatures are snake_case: `calendarToday` → `calendar_today`. */
function iconLigature(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/**
 * Type sizes for each `usageHint`. Tailwind's preflight resets headings to
 * body text, so each one gets its size here.
 */
const TEXT_STYLES: Record<string, CSSProperties> = {
  h1: { fontSize: "1.875rem", fontWeight: 600, lineHeight: 1.2 },
  h2: { fontSize: "1.5rem", fontWeight: 600, lineHeight: 1.25 },
  h3: { fontSize: "1.25rem", fontWeight: 600, lineHeight: 1.3 },
  h4: { fontSize: "1rem", fontWeight: 600, lineHeight: 1.4 },
  h5: { fontSize: "0.875rem", fontWeight: 600, lineHeight: 1.4 },
  caption: { fontSize: "0.8125rem", opacity: 0.7 },
  body: { fontSize: "0.875rem" },
};

const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5"]);

function TextNode({ text, usageHint }: { text: string; usageHint?: string }) {
  const hint = usageHint && TEXT_STYLES[usageHint] ? usageHint : "body";
  const Element = (HEADINGS.has(hint) ? hint : "p") as
    | "h1"
    | "h2"
    | "h3"
    | "h4"
    | "h5"
    | "p";
  return (
    <div className="a2ui-text">
      <section>
        <Element style={TEXT_STYLES[hint]}>
          {renderInlineMarkdown(text)}
        </Element>
      </section>
    </div>
  );
}

function ModalNode({
  entry,
  content,
}: {
  entry: ReactNode;
  content: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const open = () => dialogRef.current?.showModal();
  const close = () => dialogRef.current?.close();
  return (
    <div className="a2ui-modal">
      <section
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            open();
          }
        }}
      >
        {entry}
      </section>
      <dialog
        ref={dialogRef}
        onClick={(event) => {
          // A click on the backdrop lands on the dialog element itself.
          if (event.target === event.currentTarget) close();
        }}
      >
        <div id="controls">
          <button type="button" onClick={close} aria-label="Close">
            <span className="g-icon" aria-hidden="true">
              close
            </span>
          </button>
        </div>
        <section>{content}</section>
      </dialog>
    </div>
  );
}

function renderNode(
  id: string,
  context: RenderContext,
  ancestors: ReadonlySet<string>,
): ReactNode {
  const node = context.components.get(id);
  // A missing id or a cycle renders nothing rather than looping.
  if (!node || ancestors.has(id)) return null;
  const path = new Set(ancestors).add(id);
  const [type, props = {}] = Object.entries(node.component ?? {})[0] ?? [];
  const renderChild = (childId: string | undefined) =>
    childId ? renderNode(childId, context, path) : null;
  const renderChildren = (children: V08Children | undefined) =>
    (children?.explicitList ?? []).map((childId) => {
      const child = context.components.get(childId);
      return (
        <div
          key={childId}
          style={
            child?.weight ? { flexGrow: child.weight, minWidth: 0 } : undefined
          }
        >
          {renderChild(childId)}
        </div>
      );
    });

  switch (type) {
    case "Card":
      return (
        <div className="a2ui-card">
          <section>{renderChild(props.child)}</section>
        </div>
      );
    case "Column":
      return (
        <div className="a2ui-column">
          <section
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              alignItems: FLEX_ALIGN[props.alignment ?? "stretch"],
              justifyContent: FLEX_JUSTIFY[props.distribution ?? "start"],
            }}
          >
            {renderChildren(props.children)}
          </section>
        </div>
      );
    case "Row":
      return (
        <div className="a2ui-row">
          <section
            style={{
              display: "flex",
              flexDirection: "row",
              gap: 16,
              alignItems: FLEX_ALIGN[props.alignment ?? "center"],
              justifyContent: FLEX_JUSTIFY[props.distribution ?? "start"],
            }}
          >
            {renderChildren(props.children)}
          </section>
        </div>
      );
    case "Text":
      return (
        <TextNode
          text={resolveText(props.text, context.data)}
          usageHint={props.usageHint}
        />
      );
    case "Icon":
      return (
        <span className="g-icon" aria-hidden="true">
          {iconLigature(resolveText(props.name, context.data))}
        </span>
      );
    case "Divider":
      return (
        <div className="a2ui-divider">
          <hr />
        </div>
      );
    case "Modal":
      return (
        <ModalNode
          entry={renderChild(props.entryPointChild)}
          content={renderChild(props.contentChild)}
        />
      );
    default:
      return null;
  }
}

export function A2UIV08View({
  root,
  components,
  data,
  className,
  style,
}: {
  root: string;
  components: A2UIV08Component[];
  data: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  if (!components.length) {
    return (
      <div className={className} style={{ padding: 16, color: "#666" }}>
        No content to display
      </div>
    );
  }

  const context: RenderContext = {
    components: new Map(
      components.map((component) => [component.id, component]),
    ),
    data,
  };

  return (
    <div className={className} style={style}>
      <div className="a2ui-surface">{renderNode(root, context, new Set())}</div>
    </div>
  );
}
