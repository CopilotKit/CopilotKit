import type { Edit, SgNode } from "codemod:ast-grep";
import type TS from "codemod:ast-grep/langs/typescript";
import type TSX from "codemod:ast-grep/langs/tsx";
import { charIndex } from "./offsets.ts";

type Node = SgNode<TS | TSX>;

const TODO = "TODO(copilotkit-2.0):";
const GUIDE = "https://docs.copilotkit.ai/migrate/chat-2.0";
const V1_SOURCE = "@copilotkit/react-ui";
const COMPONENTS = new Set(["CopilotChat", "CopilotPopup", "CopilotSidebar"]);

/** v1 `labels` keys and their 2.0 `CopilotChatLabels` key. */
const LABELS: Record<string, string> = {
  title: "modalHeaderTitle",
  placeholder: "chatInputPlaceholder",
  initial: "welcomeMessageText",
  stopGenerating: "chatInputToolbarStopButtonLabel",
  regenerateResponse: "assistantMessageToolbarRegenerateLabel",
  copyToClipboard: "assistantMessageToolbarCopyMessageLabel",
  thumbsUp: "assistantMessageToolbarThumbsUpLabel",
  thumbsDown: "assistantMessageToolbarThumbsDownLabel",
  copied: "assistantMessageToolbarCopyCodeCopiedLabel",
};

/** Props that only changed name, by component. */
const RENAMED_PROPS: Record<string, Record<string, string>> = {
  CopilotPopup: { onSetOpen: "onOpenChange" },
  CopilotSidebar: { onSetOpen: "onOpenChange" },
};

const SLOT_NOTE = (prop: string, slot: string) =>
  `\`${prop}\` was removed in 2.0. Customize the ${slot} with the \`${slot}\` slot of the chat, which takes different props. See ${GUIDE}`;

/** v1 props that 2.0 does not take, and what to do instead. */
const REMOVED_PROPS: Record<string, string> = {
  instructions: `\`instructions\` was removed in 2.0. Give the agent the text with \`useAgentContext({ description, value })\`, or put it in the agent's system prompt. See ${GUIDE}`,
  makeSystemMessage: `\`makeSystemMessage\` was removed in 2.0: the agent owns its system prompt. Give it extra text with \`useAgentContext\`. See ${GUIDE}`,
  disableSystemMessage: `\`disableSystemMessage\` was removed in 2.0: the agent owns its system prompt. See ${GUIDE}`,
  suggestions: `\`suggestions\` was removed in 2.0. Configure suggestions with \`useConfigureSuggestions\`. See ${GUIDE}`,
  icons: `\`icons\` was removed in 2.0. Replace the icons through the chat's slots. See ${GUIDE}`,
  markdownTagRenderers: `\`markdownTagRenderers\` was removed in 2.0. Pass a \`markdownRenderer\` to \`CopilotKitProvider\`. See ${GUIDE}`,
  imageUploadsEnabled: `\`imageUploadsEnabled\` was removed in 2.0. Turn on uploads with the \`attachments\` prop. See ${GUIDE}`,
  inputFileAccept: `\`inputFileAccept\` was removed in 2.0. Set the accepted types in the \`attachments\` prop. See ${GUIDE}`,
  onInProgress: `\`onInProgress\` was removed in 2.0. Read \`isRunning\` from \`useAgent()\`. See ${GUIDE}`,
  onSubmitMessage: `\`onSubmitMessage\` changed in 2.0: on the chat view it replaces sending instead of running beside it. Subscribe to the agent with \`useAgent()\` to react to new messages. See ${GUIDE}`,
  onStopGeneration: `\`onStopGeneration\` was removed in 2.0. See ${GUIDE}`,
  onReloadMessages: `\`onReloadMessages\` was removed in 2.0. See ${GUIDE}`,
  onRegenerate: `\`onRegenerate\` was removed in 2.0. See ${GUIDE}`,
  onCopy: `\`onCopy\` was removed in 2.0. See ${GUIDE}`,
  onThumbsUp: `\`onThumbsUp\` was removed in 2.0. See ${GUIDE}`,
  onThumbsDown: `\`onThumbsDown\` was removed in 2.0. See ${GUIDE}`,
  hitEscapeToClose: `\`hitEscapeToClose\` was removed in 2.0. See ${GUIDE}`,
  shortcut: `\`shortcut\` was removed in 2.0. See ${GUIDE}`,
  Input: SLOT_NOTE("Input", "input"),
  Messages: SLOT_NOTE("Messages", "messageView"),
  AssistantMessage: SLOT_NOTE("AssistantMessage", "messageView"),
  UserMessage: SLOT_NOTE("UserMessage", "messageView"),
  ErrorMessage: SLOT_NOTE("ErrorMessage", "messageView"),
  RenderTextMessage: SLOT_NOTE("RenderTextMessage", "messageView"),
  RenderActionExecutionMessage: `\`RenderActionExecutionMessage\` was removed in 2.0. Render tool calls with \`useRenderTool\`. See ${GUIDE}`,
  RenderAgentStateMessage: `\`RenderAgentStateMessage\` was removed in 2.0. Render agent state with \`useAgent()\`. See ${GUIDE}`,
  RenderResultMessage: `\`RenderResultMessage\` was removed in 2.0. Render tool results with \`useRenderTool\`. See ${GUIDE}`,
  RenderImageMessage: SLOT_NOTE("RenderImageMessage", "messageView"),
  Header: SLOT_NOTE("Header", "header"),
  Button: SLOT_NOTE("Button", "toggleButton"),
  Window: `\`Window\` was removed in 2.0. Style the window with \`className\`, \`width\` and \`height\`. See ${GUIDE}`,
};

/** Popup-only props that the sidebar and the plain chat do not take. */
const POPUP_ONLY = new Set(["clickOutsideToClose"]);

/**
 * Migrates the props of the v1 chat components (`CopilotChat`,
 * `CopilotPopup`, `CopilotSidebar` from `@copilotkit/react-ui`):
 *
 * - `labels` keys get their 2.0 names (`title` → `modalHeaderTitle`, ...);
 * - renamed props get their 2.0 name (`onSetOpen` → `onOpenChange`);
 * - each prop 2.0 removed gets a TODO that names the 2.0 way.
 *
 * Runs before the import pass moves the import to `@copilotkit/react-core`,
 * while the import still says the element is the v1 component.
 * Returns the new source, or `null` when nothing changed.
 */
export function migrateChatComponents(
  rootNode: Node,
  jsx: boolean,
): string | null {
  if (!jsx) return null;
  const source = rootNode.text();
  if (!source.includes(V1_SOURCE)) return null;
  const locals = new Map<string, string>();
  for (const statement of rootNode.findAll({
    rule: { kind: "import_statement" },
  })) {
    if (statement.field("source")?.text().slice(1, -1) !== V1_SOURCE) continue;
    for (const specifier of statement.findAll({
      rule: { kind: "import_specifier" },
    })) {
      const name = specifier.field("name")?.text();
      if (!name || !COMPONENTS.has(name)) continue;
      const local = (
        specifier.field("alias") ?? specifier.field("name")
      )?.text();
      if (local) locals.set(local, name);
    }
  }
  if (locals.size === 0) return null;

  const tsx = rootNode as SgNode<TSX>;
  const elements = tsx.findAll({
    rule: {
      any: [
        { kind: "jsx_opening_element" },
        { kind: "jsx_self_closing_element" },
      ],
    },
  });
  const edits: Edit[] = [];
  for (const element of elements) {
    const component = locals.get(element.field("name")?.text() ?? "");
    if (!component) continue;
    for (const attribute of element.children()) {
      if (attribute.kind() !== "jsx_attribute") continue;
      const nameNode = attribute.child(0);
      const prop = nameNode?.text();
      if (!nameNode || prop === undefined) continue;
      const renamed = RENAMED_PROPS[component]?.[prop];
      if (renamed) {
        edits.push(nameNode.replace(renamed));
        continue;
      }
      if (prop === "labels") {
        edits.push(...labelEdits(attribute as unknown as Node, source));
        continue;
      }
      const note =
        POPUP_ONLY.has(prop) && component !== "CopilotPopup"
          ? `\`${prop}\` is a \`CopilotPopup\` prop in 2.0. See ${GUIDE}`
          : Object.hasOwn(REMOVED_PROPS, prop)
            ? REMOVED_PROPS[prop]
            : undefined;
      if (note) {
        const edit = commentBefore(attribute as unknown as Node, note, source);
        if (edit) edits.push(edit);
      }
    }
  }
  if (edits.length === 0) return null;
  return rootNode.commitEdits(edits);
}

/** Renames the keys of an object-literal `labels`, and marks the rest. */
function labelEdits(attribute: Node, source: string): Edit[] {
  const value = attribute
    .children()
    .find((child) => child.kind() === "jsx_expression");
  const object = value?.children().find((child) => child.kind() === "object");
  if (!object) {
    const edit = commentBefore(
      attribute,
      `The \`labels\` keys changed in 2.0 (\`title\` is \`modalHeaderTitle\`, \`placeholder\` is \`chatInputPlaceholder\`, \`initial\` is \`welcomeMessageText\`, ...). See ${GUIDE}`,
      source,
    );
    return edit ? [edit] : [];
  }
  const edits: Edit[] = [];
  for (const entry of object.children()) {
    if (entry.kind() !== "pair") continue;
    const key = entry.field("key");
    if (!key) continue;
    const name = key.kind() === "string" ? key.text().slice(1, -1) : key.text();
    const target = Object.hasOwn(LABELS, name) ? LABELS[name] : undefined;
    // `initial` could be a list of messages in v1; 2.0 shows one welcome text.
    const value = entry.field("value");
    if (
      name === "initial" &&
      value &&
      !["string", "template_string"].includes(value.kind())
    ) {
      const edit = commentBefore(
        entry,
        `\`initial\` messages were removed in 2.0. The chat shows one \`welcomeMessageText\` instead. See ${GUIDE}`,
        source,
      );
      if (edit) edits.push(edit);
      continue;
    }
    if (target) {
      edits.push(key.replace(target));
    } else if (name === "error") {
      const edit = commentBefore(
        entry,
        `The \`error\` label was removed in 2.0. Handle errors with the \`onError\` prop of the chat. See ${GUIDE}`,
        source,
      );
      if (edit) edits.push(edit);
    }
  }
  return edits;
}

function commentBefore(
  node: Node,
  message: string,
  source: string,
): Edit | undefined {
  const comment = `/* ${TODO} ${message} */`;
  const start = node.range().start.index;
  if (source.slice(0, charIndex(source, start)).trimEnd().endsWith(comment)) {
    return undefined;
  }
  return { startPos: start, endPos: start, insertedText: `${comment} ` };
}
