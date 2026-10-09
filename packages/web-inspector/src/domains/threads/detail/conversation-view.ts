import { html, nothing } from "lit";
import type { TemplateResult } from "lit";
import type {
  ConversationAssistant,
  ConversationGenerativeUIItem,
  ConversationRenderItem,
  ConversationToolCall,
  ConversationUser,
  ToolCallGroup,
} from "./message-adapter.js";
import { renderThreadJsonValue } from "./state-view.js";

type ConversationViewOptions = {
  collapseThreshold: number;
  expandedMessages: Set<string>;
  expandedTools: Set<string>;
  /** Tool calls of the current run that are still receiving arguments. */
  streamingTools?: ReadonlySet<string>;
  onToggleMessage: (id: string) => void;
  onToggleTool: (id: string) => void;
};

function renderBubble(
  item: ConversationUser | ConversationAssistant,
  options: ConversationViewOptions,
): TemplateResult {
  const isUser = item.type === "user";
  const expanded = options.expandedMessages.has(item.id);
  const tooLong = item.content.length > options.collapseThreshold;
  const shown =
    tooLong && !expanded
      ? item.content.slice(0, options.collapseThreshold) + "…"
      : item.content;
  return html`
    <div
      class="cpk-td__bubble ${
        isUser ? "cpk-td__bubble--user" : "cpk-td__bubble--assistant"
      }"
      data-message-id=${item.id}
      role="group"
      aria-label=${isUser ? "User message" : "Assistant message"}
    >
      <div
        class="cpk-td__bubble-inner ${
          isUser
            ? "cpk-td__bubble-inner--user"
            : "cpk-td__bubble-inner--assistant"
        }"
      >
        <div style="white-space:pre-wrap">${shown}</div>
        ${
          tooLong
            ? html`<button
              type="button"
              class="cpk-td__show-more"
              aria-expanded=${expanded ? "true" : "false"}
              @click=${() => options.onToggleMessage(item.id)}
              >${expanded ? "Show less" : "Show more"}</button
            >`
            : nothing
        }
      </div>
    </div>
  `;
}

function readableToolName(toolName: string): string {
  const label = toolName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function renderToolBlock(
  item: ConversationToolCall,
  options: ConversationViewOptions,
): TemplateResult {
  const streaming =
    (options.streamingTools?.has(item.toolCallId) ?? false) && !item.hasResult;
  const expanded = options.expandedTools.has(item.id);
  const pending = item.resultUnreadable || (!item.hasResult && !streaming);
  return html`
    <div class="cpk-td__tool-block">
      <button
        type="button"
        class="cpk-td__tool-header"
        aria-expanded=${expanded ? "true" : "false"}
        @click=${() => options.onToggleTool(item.id)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span class="cpk-td__tool-copy">
          <span class="cpk-td__tool-title">
            <span
              class="cpk-td__tool-name ${
                streaming ? "cpk-td__tool-name--streaming" : ""
              }"
              >${readableToolName(item.toolName)}</span
            ><code class="cpk-td__tool-identifier">(${item.toolName})</code>
          </span>
          <span
            class="cpk-td__tool-status ${
              pending ? "cpk-td__tool-status--pending" : ""
            }"
            >${
              streaming
                ? "Receiving arguments"
                : item.resultUnreadable
                  ? "Result unreadable"
                  : item.hasResult
                    ? "Result received"
                    : "No result recorded"
            }</span
          >
        </span>
        <svg
          class="cpk-td__tool-chevron"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="m9 6 6 6-6 6"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      ${
        expanded
          ? html`
            <div class="cpk-td__tool-body">
              <div class="cpk-td__tool-data">
                <section>
                  <div class="cpk-td__tool-section-label">Arguments</div>
                  ${renderThreadJsonValue(item.arguments)}
                </section>
                ${
                  item.hasResult
                    ? html`
                      <section class="cpk-td__tool-result">
                        <div class="cpk-td__tool-section-label">Result</div>
                        ${renderThreadJsonValue(item.result)}
                      </section>
                    `
                    : nothing
                }
              </div>
            </div>
          `
          : nothing
      }
    </div>
  `;
}

function renderToolGroup(
  group: ToolCallGroup,
  options: ConversationViewOptions,
): TemplateResult {
  return html`
    <div class="cpk-td__tool-group">
      <div class="cpk-td__tool-group-header">
        ${group.items.length} tool call${group.items.length !== 1 ? "s" : ""}
      </div>
      ${group.items.map((item) => renderToolBlock(item, options))}
    </div>
  `;
}

function renderGenerativeUI(
  item: ConversationGenerativeUIItem,
): TemplateResult {
  return html`
    <div class="cpk-td__genui">
      <div class="cpk-td__genui-badge">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
        <span>Generative UI</span>
        <code class="cpk-td__genui-component">${item.activityType}</code>
      </div>
    </div>
  `;
}

function renderConversationItem(
  item: ConversationRenderItem,
  options: ConversationViewOptions,
): TemplateResult | typeof nothing {
  switch (item.type) {
    case "user":
    case "assistant":
      return renderBubble(item, options);
    case "tool_call":
      return renderToolBlock(item, options);
    case "tool_call_group":
      return renderToolGroup(item, options);
    case "reasoning":
      return html`<div class="cpk-td__inline-chip">
        <span>Reasoned for ${item.duration}</span>
      </div>`;
    case "state_update":
      return html`
        <div class="cpk-td__inline-chip">
          <span>Updated agent state</span>
        </div>
      `;
    case "generative-ui":
      return renderGenerativeUI(item);
    case "agent_responded":
      return nothing;
  }
}

export function renderConversationItems(
  items: ConversationRenderItem[],
  options: ConversationViewOptions,
): TemplateResult {
  return html`${items.map((item) => renderConversationItem(item, options))}`;
}
