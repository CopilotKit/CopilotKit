import type { NativeNodeKind } from "@copilotkit/channels-ui";

export interface SlackCatalogEntry {
  readonly component: string;
  readonly type: string;
  readonly kind: NativeNodeKind;
  readonly childrenSlot?: string;
  readonly required?: readonly string[];
  readonly source: string;
}

const BLOCKS = "https://docs.slack.dev/reference/block-kit/blocks/";
const ELEMENTS = "https://docs.slack.dev/reference/block-kit/block-elements/";
const OBJECTS =
  "https://docs.slack.dev/reference/block-kit/composition-objects/";

/**
 * Reviewed message-valid Slack Block Kit catalog — the blocks an app can
 * actually post. Two documented blocks are deliberately absent:
 *
 * - `alert`: "Alert blocks are currently only supported in modals." Verified by
 *   posting Slack's own example into a message and having it refused, while a
 *   plain section in the same delivery arrived.
 * - `file`: "You can't add this block to app surfaces directly, but it will
 *   show up when retrieving messages that contain remote files." The same
 *   sentence appears in `@slack/types`' own doc comment. It is an inbound
 *   shape, not an authorable one — offering it means offering a component that
 *   can never succeed. Sending a file is `thread.postFile()`.
 */
export const SLACK_BLOCK_MANIFEST = [
  ["Actions", "actions", "elements"],
  ["Card", "card"],
  ["Carousel", "carousel", "elements"],
  ["Container", "container", "child_blocks"],
  ["Context", "context", "elements"],
  ["ContextActions", "context_actions", "elements"],
  ["DataTable", "data_table", "rows"],
  ["DataVisualization", "data_visualization"],
  ["Divider", "divider"],
  ["Header", "header", "text"],
  ["Image", "image"],
  ["Input", "input", "element"],
  ["Markdown", "markdown"],
  ["Plan", "plan", "tasks"],
  ["RichText", "rich_text", "elements"],
  ["Section", "section", "fields"],
  ["Table", "table", "rows"],
  ["TaskCard", "task_card", "tasks"],
  ["Video", "video"],
] as const satisfies ReadonlyArray<
  readonly [component: string, type: string, childrenSlot?: string]
>;

export const SLACK_ELEMENT_MANIFEST = [
  ["Button", "button"],
  ["Checkboxes", "checkboxes", "options"],
  ["ChannelsSelect", "channels_select"],
  ["ConversationsSelect", "conversations_select"],
  ["DatePicker", "datepicker"],
  ["DateTimePicker", "datetimepicker"],
  ["EmailInput", "email_text_input"],
  ["ExternalSelect", "external_select"],
  ["FeedbackButtons", "feedback_buttons"],
  ["IconButton", "icon_button"],
  ["Image", "image"],
  ["MultiChannelsSelect", "multi_channels_select"],
  ["MultiConversationsSelect", "multi_conversations_select"],
  ["MultiExternalSelect", "multi_external_select"],
  ["MultiStaticSelect", "multi_static_select", "option_groups"],
  ["MultiUsersSelect", "multi_users_select"],
  ["NumberInput", "number_input"],
  ["Overflow", "overflow", "options"],
  ["PlainTextInput", "plain_text_input"],
  ["RadioButtons", "radio_buttons", "options"],
  ["RichTextInput", "rich_text_input"],
  ["StaticSelect", "static_select", "option_groups"],
  ["TimePicker", "timepicker"],
  ["UrlInput", "url_text_input"],
  ["UsersSelect", "users_select"],
  ["WorkflowButton", "workflow_button"],
] as const satisfies ReadonlyArray<
  readonly [component: string, type: string, childrenSlot?: string]
>;

export const SLACK_OBJECT_MANIFEST = [
  ["ConfirmationDialog", "confirm"],
  ["ConversationFilter", "conversation_filter"],
  ["DispatchActionConfig", "dispatch_action_config"],
  ["MarkdownText", "mrkdwn"],
  ["Option", "option"],
  ["OptionGroup", "option_group", "options"],
  ["PlainText", "plain_text"],
  ["RichTextList", "rich_text_list", "elements"],
  ["RichTextPreformatted", "rich_text_preformatted", "elements"],
  ["RichTextQuote", "rich_text_quote", "elements"],
  ["RichTextSection", "rich_text_section", "elements"],
  ["RichTextText", "text"],
  ["SlackFile", "slack_file"],
  ["Trigger", "trigger"],
  ["Workflow", "workflow"],
] as const satisfies ReadonlyArray<
  readonly [component: string, type: string, childrenSlot?: string]
>;

/**
 * Composition objects that carry **no** `type` discriminator in Slack's schema.
 * Text and rich-text nodes are tagged (`plain_text`, `mrkdwn`, `text`,
 * `rich_text_section`, …); the rest are plain structures — an option is
 * `{text, value}`, a confirm dialog is `{title, text, confirm, deny}`. Emitting
 * a `type` on those is an unknown field and Slack refuses the entire message,
 * which took out every select, checkbox, radio group and overflow menu authored
 * through this catalog.
 *
 * The manifest still needs the type string as its lookup key, so the exclusion
 * is recorded here rather than by leaving the entry untyped.
 */
export const SLACK_UNTYPED_OBJECTS: ReadonlySet<string> = new Set([
  "confirm",
  "conversation_filter",
  "dispatch_action_config",
  "option",
  "option_group",
  "slack_file",
  "trigger",
  "workflow",
]);

function entries(
  rows: ReadonlyArray<readonly [string, string, string?]>,
  kind: NativeNodeKind,
  source: string,
): SlackCatalogEntry[] {
  return rows.map(([component, type, childrenSlot]) => ({
    component,
    type,
    kind,
    ...(childrenSlot ? { childrenSlot } : {}),
    source,
  }));
}

export const SLACK_NATIVE_MANIFEST: readonly SlackCatalogEntry[] = [
  ...entries(SLACK_BLOCK_MANIFEST, "block", BLOCKS),
  ...entries(SLACK_ELEMENT_MANIFEST, "element", ELEMENTS),
  ...entries(SLACK_OBJECT_MANIFEST, "object", OBJECTS),
];
