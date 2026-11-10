import { useId, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { ChannelInteraction, WebUiNode } from "../wire.js";

export type HeadingLevel = 2 | 3 | 4 | 5 | 6;

export interface ChannelUiProps {
  /** The UI of one message, from a `channels.ui` event. */
  ir: readonly WebUiNode[];
  /** The message id, sent back with each interaction so handlers can update the message. */
  messageId?: string;
  /** Called when the user clicks a button, or submits a select or input. */
  onAction?: (interaction: ChannelInteraction) => void;
  /** Disable every control, for example while a click is in flight. */
  disabled?: boolean;
  /** Heading level for `<Header>`. Defaults to 3. */
  headingLevel?: HeadingLevel;
  /** Render `<Markdown>` text. Without it the text renders as plain text. */
  renderMarkdown?: (text: string) => ReactNode;
  /** Extra class on the root element. */
  className?: string;
}

interface RenderContext {
  messageId?: string;
  onAction?: (interaction: ChannelInteraction) => void;
  disabled: boolean;
  headingLevel: HeadingLevel;
  renderMarkdown?: (text: string) => ReactNode;
}

const SAFE_LINK = /^(https?:|mailto:)/i;
const SAFE_IMAGE = /^(https?:|data:image\/)/i;

function children(node: WebUiNode): WebUiNode[] {
  return Array.isArray(node.props.children) ? node.props.children : [];
}

function text(node: WebUiNode): string {
  if (node.type === "text") return String(node.props.value ?? "");
  return children(node).map(text).join("");
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Stable hooks for styling: `class="channels-ui-<type>"` and `data-channels-ui="<type>"`. */
function hooks(type: string) {
  return { className: `channels-ui-${type}`, "data-channels-ui": type };
}

function renderNodes(
  nodes: readonly WebUiNode[],
  ctx: RenderContext,
): ReactNode {
  return nodes.map((node, index) => (
    <Node key={node.key ?? index} node={node} ctx={ctx} />
  ));
}

function send(
  ctx: RenderContext,
  id: string,
  value: unknown,
  values?: Record<string, unknown>,
): void {
  ctx.onAction?.({
    id,
    ...(value !== undefined ? { value } : {}),
    ...(values ? { values } : {}),
    ...(ctx.messageId ? { messageId: ctx.messageId } : {}),
  });
}

function ButtonNode({ node, ctx }: { node: WebUiNode; ctx: RenderContext }) {
  const label = renderNodes(children(node), ctx);
  const url = str(node.props.url);
  const style = str(node.props.style);
  if (url) {
    if (!SAFE_LINK.test(url)) return <span {...hooks("button")}>{label}</span>;
    return (
      <a {...hooks("button")} data-style={style} href={url}>
        {label}
      </a>
    );
  }
  const id = str(node.props.onClick);
  return (
    <button
      {...hooks("button")}
      type="button"
      data-style={style}
      disabled={ctx.disabled || !id || !ctx.onAction}
      onClick={() => {
        if (id) send(ctx, id, node.props.value);
      }}
    >
      {label}
    </button>
  );
}

interface SelectOption {
  label: string;
  value: string;
}

function SelectNode({ node, ctx }: { node: WebUiNode; ctx: RenderContext }) {
  const selectId = useId();
  const id = str(node.props.onSelect);
  const multi = node.props.multi === true;
  const options = (
    Array.isArray(node.props.options) ? node.props.options : []
  ) as SelectOption[];
  const label = str(node.props.placeholder) ?? "Choose an option";
  const name = str(node.props.name);
  const disabled = ctx.disabled || !id || !ctx.onAction;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!id) return;
    const select = event.currentTarget.elements.namedItem(
      selectId,
    ) as HTMLSelectElement | null;
    if (!select) return;
    const chosen = Array.from(select.selectedOptions, (o) => o.value).filter(
      (v) => v.length > 0,
    );
    if (chosen.length === 0) return;
    const value = multi ? chosen : chosen[0];
    send(ctx, id, value, name ? { [name]: value } : undefined);
  };

  return (
    <form {...hooks("select")} onSubmit={onSubmit}>
      <label htmlFor={selectId}>{label}</label>
      <select
        id={selectId}
        name={selectId}
        multiple={multi}
        disabled={disabled}
        defaultValue={multi ? [] : ""}
      >
        {multi ? null : (
          <option value="" disabled>
            {label}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button type="submit" disabled={disabled}>
        Send
      </button>
    </form>
  );
}

function InputNode({ node, ctx }: { node: WebUiNode; ctx: RenderContext }) {
  const inputId = useId();
  const [value, setValue] = useState("");
  const id = str(node.props.onSubmit);
  const label = str(node.props.placeholder) ?? "Your answer";
  const name = str(node.props.name);
  const disabled = ctx.disabled || !id || !ctx.onAction;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!id || value.trim().length === 0) return;
    send(ctx, id, value, name ? { [name]: value } : undefined);
  };

  const field =
    node.props.multiline === true ? (
      <textarea
        id={inputId}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
      />
    ) : (
      <input
        id={inputId}
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
      />
    );

  return (
    <form {...hooks("input")} onSubmit={onSubmit}>
      <label htmlFor={inputId}>{label}</label>
      {field}
      <button type="submit" disabled={disabled}>
        Send
      </button>
    </form>
  );
}

function TableNode({ node, ctx }: { node: WebUiNode; ctx: RenderContext }) {
  const columns = (
    Array.isArray(node.props.columns) ? node.props.columns : []
  ) as Array<{ header?: unknown; align?: unknown }>;
  const rows = children(node).filter((row) => row.type === "row");
  return (
    <table {...hooks("table")}>
      {columns.length > 0 ? (
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th key={index} scope="col" data-align={str(column.align)}>
                {String(column.header ?? "")}
              </th>
            ))}
          </tr>
        </thead>
      ) : null}
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={row.key ?? rowIndex}>
            {children(row).map((cell, cellIndex) => (
              <td
                key={cell.key ?? cellIndex}
                data-align={str(columns[cellIndex]?.align)}
              >
                {renderNodes(children(cell), ctx)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Node({
  node,
  ctx,
}: {
  node: WebUiNode;
  ctx: RenderContext;
}): ReactNode {
  const inner = () => renderNodes(children(node), ctx);
  switch (node.type) {
    case "text":
      return String(node.props.value ?? "");
    case "message": {
      const accent = str(node.props.accent);
      return (
        <div {...hooks("message")} data-accent={accent}>
          {inner()}
        </div>
      );
    }
    case "header": {
      const Heading = `h${ctx.headingLevel}` as const;
      return <Heading {...hooks("header")}>{inner()}</Heading>;
    }
    case "section":
    case "context":
    case "actions":
      return <div {...hooks(node.type)}>{inner()}</div>;
    case "markdown": {
      const value = text(node);
      return (
        <div {...hooks("markdown")} style={{ whiteSpace: "pre-wrap" }}>
          {ctx.renderMarkdown ? ctx.renderMarkdown(value) : value}
        </div>
      );
    }
    case "fields":
      return (
        <ul {...hooks("fields")} role="list">
          {children(node).map((field, index) => (
            <li key={field.key ?? index} {...hooks("field")}>
              {str(field.props.label) ? (
                <>
                  <strong className="channels-ui-field-label">
                    {String(field.props.label)}
                  </strong>{" "}
                </>
              ) : null}
              {renderNodes(children(field), ctx)}
            </li>
          ))}
        </ul>
      );
    case "field":
      return (
        <div {...hooks("field")}>
          {str(node.props.label) ? (
            <>
              <strong className="channels-ui-field-label">
                {String(node.props.label)}
              </strong>{" "}
            </>
          ) : null}
          {inner()}
        </div>
      );
    case "button":
      return <ButtonNode node={node} ctx={ctx} />;
    case "select":
      return <SelectNode node={node} ctx={ctx} />;
    case "input":
      return <InputNode node={node} ctx={ctx} />;
    case "image": {
      const url = str(node.props.url);
      if (!url || !SAFE_IMAGE.test(url)) return null;
      return (
        // A framework-agnostic renderer: plain <img>, not next/image.
        // oxlint-disable-next-line nextjs/no-img-element
        <img {...hooks("image")} src={url} alt={str(node.props.alt) ?? ""} />
      );
    }
    case "divider":
      return <hr {...hooks("divider")} />;
    case "table":
      return <TableNode node={node} ctx={ctx} />;
    case "render": {
      const alt = str(node.props.alt);
      return alt ? <p {...hooks("render")}>{alt}</p> : null;
    }
    default: {
      // Unknown node: keep its content, drop the wrapper.
      const kids = children(node);
      return kids.length > 0 ? <>{renderNodes(kids, ctx)}</> : null;
    }
  }
}

/**
 * Render the UI of one Channel message (`<Message>`, `<Section>`, buttons,
 * selects, …) as plain semantic HTML.
 *
 * It ships no styles. Every element has a `channels-ui-<type>` class and a
 * `data-channels-ui="<type>"` attribute to style against.
 */
export function ChannelUi(props: ChannelUiProps): ReactNode {
  const ctx: RenderContext = {
    messageId: props.messageId,
    onAction: props.onAction,
    disabled: props.disabled ?? false,
    headingLevel: props.headingLevel ?? 3,
    renderMarkdown: props.renderMarkdown,
  };
  return (
    <div
      className={["channels-ui", props.className].filter(Boolean).join(" ")}
      data-channels-ui="root"
    >
      {renderNodes(props.ir, ctx)}
    </div>
  );
}
