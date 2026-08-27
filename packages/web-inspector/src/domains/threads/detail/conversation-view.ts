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
    >
      <div
        class="cpk-td__bubble-inner ${
          isUser
            ? "cpk-td__bubble-inner--user"
            : "cpk-td__bubble-inner--assistant"
        }"
      >
        ${shown}
        ${
          tooLong
            ? html`<span
              class="cpk-td__show-more"
              @click=${() => options.onToggleMessage(item.id)}
              >${expanded ? "Show less" : "Show more"}</span
            >`
            : nothing
        }
      </div>
    </div>
  `;
}

function renderToolBlock(
  item: ConversationToolCall,
  options: ConversationViewOptions,
): TemplateResult {
  const expanded = options.expandedTools.has(item.id);
  return html`
    <div class="cpk-td__tool-block">
      <div
        class="cpk-td__tool-header"
        @click=${() => options.onToggleTool(item.id)}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path
            d="M1 9C1 9 2 7 5 7C8 7 9 9 9 9M5 1C5 1 7 2.5 7 4.5C7 6.5 5 7 5 7C5 7 3 6.5 3 4.5C3 2.5 5 1 5 1Z"
            stroke="#087653"
            stroke-width="1.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span class="cpk-td__tool-name">${item.toolName}</span>
        ${
          item.result || Object.keys(item.arguments).length > 0
            ? html`
                <span class="cpk-td__tool-status">DONE</span>
              `
            : html`
                <span class="cpk-td__tool-status cpk-td__tool-status--pending">PENDING</span>
              `
        }
        <span class="cpk-td__tool-chevron">${expanded ? "▾" : "▸"}</span>
      </div>
      ${
        expanded
          ? html`
            <div class="cpk-td__tool-body">
              <div class="cpk-td__tool-section-label">Arguments</div>
              ${renderThreadJsonValue(item.arguments)}
              ${
                item.result
                  ? html`
                    <div
                      class="cpk-td__tool-section-label"
                      style="margin-top:8px"
                    >
                      Result
                    </div>
                    ${renderThreadJsonValue(item.result)}
                  `
                  : nothing
              }
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
        Generative UI
      </div>
      <div class="cpk-td__genui-placeholder">
        ${item.activityType} — rendered in chat
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
