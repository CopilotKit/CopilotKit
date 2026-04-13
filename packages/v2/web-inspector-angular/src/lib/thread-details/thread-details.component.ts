import {
  Component,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  input,
  effect,
  signal,
  computed,
  inject,
  untracked,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { DomSanitizer, SafeHtml } from "@angular/platform-browser";
import { EmptyEventsComponent } from "../empty-events/empty-events.component";

// ---- Types ------------------------------------------------------------------

// Mirrors ɵThread / ThreadRecord from @copilotkit/core — kept local to avoid
// a direct package dependency from the Angular component.
export interface InspectorThreadMeta {
  id: string;
  name: string | null;
  createdAt: string;
  updatedAt: string;
  agentId: string;
  createdById: string;
}

interface ApiThreadMessage {
  id: string;
  role: string;
  content?: string;
  toolCalls?: Array<{ id: string; name: string; args: string }>;
  toolCallId?: string;
  /** Present when role === "activity" (Generative UI output). */
  activityType?: string;
}

export interface ConversationUser {
  id: string;
  type: "user";
  content: string;
  createdAt: string;
}

export interface ConversationAssistant {
  id: string;
  type: "assistant";
  content: string;
  createdAt: string;
}

export interface ConversationToolCall {
  id: string;
  type: "tool_call";
  toolName: string;
  toolCallId: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown> | null;
  createdAt: string;
  groupId?: string;
}

export interface ToolCallGroup {
  type: "tool_call_group";
  id: string;
  items: ConversationToolCall[];
}

export type RenderItem = ConversationItem | ToolCallGroup;

export interface ConversationReasoning {
  id: string;
  type: "reasoning";
  duration: string;
  createdAt: string;
}

export interface ConversationStateUpdate {
  id: string;
  type: "state_update";
  createdAt: string;
}

export interface ConversationAgentResponded {
  id: string;
  type: "agent_responded";
  createdAt: string;
}

/**
 * Represents a Generative UI output from an agent ActivityMessage.
 *
 * Rendering tiers (crawl → walk → run):
 *   Crawl (current): labeled card showing activityType — no actual rendering.
 *   Walk  (future):  render completed HTML/CSS/JS in a sandboxed iframe once
 *                    the Angular inspector stabilises. Target open-ended mode
 *                    only; static (React) components cannot be rendered here.
 *   Run   (future):  streaming iframe with full fidelity, JSON-patch updates.
 */
export interface ConversationGenerativeUI {
  id: string;
  type: "generative-ui";
  /** AG-UI activityType (e.g. "open-generative-ui"). Used as label in crawl phase. */
  activityType: string;
  /** Pre-rendered HTML for demo/scripted mode. Not present for live runtime data. */
  html?: string;
  createdAt: string;
}

export type ConversationItem =
  | ConversationUser
  | ConversationAssistant
  | ConversationToolCall
  | ConversationReasoning
  | ConversationStateUpdate
  | ConversationAgentResponded
  | ConversationGenerativeUI;

export interface AgentEvent {
  type: string;
  timestamp: string | number;
  payload: Record<string, unknown>;
}

// ---- Component --------------------------------------------------------------

type Tab = "conversation" | "agent-state" | "ag-ui-events";

@Component({
  selector: "cpk-thread-details",
  standalone: true,
  imports: [CommonModule, EmptyEventsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.ShadowDom,
  template: `
    <div class="cpk-td">
      <!-- ── Left area: tabs + content ─────────────────────────────────── -->
      <div class="cpk-td__left">
        <!-- Tab bar -->
        <div class="cpk-td__tabs-header">
          <div class="cpk-td__tab-group" role="tablist">
            <button
              *ngFor="let tab of TAB_LIST"
              role="tab"
              class="cpk-td__tab"
              [class.cpk-td__tab--active]="activeTab() === tab.id"
              (click)="activeTab.set(tab.id)"
            >
              {{ tab.label }}
            </button>
          </div>
          <button
            class="cpk-td__panel-toggle"
            [class.cpk-td__panel-toggle--active]="showDetailPanel()"
            (click)="showDetailPanel.set(!showDetailPanel())"
            title="Toggle thread details"
            type="button"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="15" y1="3" x2="15" y2="21" />
            </svg>
          </button>
        </div>

        <!-- Scrollable content area -->
        <div class="cpk-td__content">
          <!-- ── Conversation tab ── -->
          <ng-container *ngIf="activeTab() === 'conversation'">
            <div *ngIf="isLoadingMessages()" class="cpk-td__status">
              Loading messages…
            </div>
            <div
              *ngIf="messagesError()"
              class="cpk-td__status cpk-td__status--error"
            >
              {{ messagesError() }}
            </div>

            <div
              *ngIf="
                !isLoadingMessages() && !messagesError() && renderItems.length === 0
              "
              class="cpk-td__empty-state"
            >
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path
                  d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                />
              </svg>
              <span>No messages yet</span>
            </div>

            <ng-container *ngFor="let item of renderItems">
              <!-- User bubble -->
              <ng-container *ngIf="item.type === 'user'">
                <div class="cpk-td__bubble cpk-td__bubble--user">
                  <div class="cpk-td__bubble-inner cpk-td__bubble-inner--user">
                    {{
                      asUser(item).content.length > COLLAPSE_THRESHOLD &&
                      !isMessageExpanded(item.id)
                        ? asUser(item).content.slice(0, COLLAPSE_THRESHOLD) + "…"
                        : asUser(item).content
                    }}
                    <span
                      *ngIf="asUser(item).content.length > COLLAPSE_THRESHOLD"
                      class="cpk-td__show-more"
                      (click)="toggleMessage(item.id)"
                      >{{
                        isMessageExpanded(item.id) ? "Show less" : "Show more"
                      }}</span
                    >
                  </div>
                </div>
              </ng-container>

              <!-- Assistant bubble -->
              <ng-container *ngIf="item.type === 'assistant'">
                <div class="cpk-td__bubble cpk-td__bubble--assistant">
                  <div class="cpk-td__bubble-inner cpk-td__bubble-inner--assistant">
                    {{
                      asAssistant(item).content.length > COLLAPSE_THRESHOLD &&
                      !isMessageExpanded(item.id)
                        ? asAssistant(item).content.slice(0, COLLAPSE_THRESHOLD) +
                          "…"
                        : asAssistant(item).content
                    }}
                    <span
                      *ngIf="asAssistant(item).content.length > COLLAPSE_THRESHOLD"
                      class="cpk-td__show-more"
                      (click)="toggleMessage(item.id)"
                      >{{
                        isMessageExpanded(item.id) ? "Show less" : "Show more"
                      }}</span
                    >
                  </div>
                </div>
              </ng-container>

              <!-- Single tool call -->
              <ng-container *ngIf="item.type === 'tool_call'">
                <ng-container
                  *ngTemplateOutlet="
                    toolBlock;
                    context: { $implicit: asToolCall(item) }
                  "
                ></ng-container>
              </ng-container>

              <!-- Tool call group -->
              <ng-container *ngIf="item.type === 'tool_call_group'">
                <div class="cpk-td__tool-group">
                  <div class="cpk-td__tool-group-header">
                    {{ asToolCallGroup(item).items.length }} tool call{{
                      asToolCallGroup(item).items.length !== 1 ? "s" : ""
                    }}
                  </div>
                  <ng-container *ngFor="let tc of asToolCallGroup(item).items">
                    <ng-container
                      *ngTemplateOutlet="toolBlock; context: { $implicit: tc }"
                    ></ng-container>
                  </ng-container>
                </div>
              </ng-container>

              <!-- Reasoning chip -->
              <ng-container *ngIf="item.type === 'reasoning'">
                <div class="cpk-td__inline-chip">
                  <span>Reasoned for {{ asReasoning(item).duration }}</span>
                </div>
              </ng-container>

              <!-- State update chip -->
              <ng-container *ngIf="item.type === 'state_update'">
                <div class="cpk-td__inline-chip">
                  <span>Updated agent state</span>
                </div>
              </ng-container>

              <!-- Generative UI output -->
              <ng-container *ngIf="item.type === 'generative-ui'">
                <div class="cpk-td__genui">
                  <div class="cpk-td__genui-badge">
                    <svg
                      width="9"
                      height="9"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                    </svg>
                    Generative UI
                  </div>
                  <ng-container *ngIf="asGenerativeUI(item).html; else genuiLabel">
                    <div
                      class="cpk-td__genui-card"
                      [innerHTML]="safeGenerativeUiHtml(asGenerativeUI(item))"
                    ></div>
                  </ng-container>
                  <ng-template #genuiLabel>
                    <div class="cpk-td__genui-placeholder">
                      {{ asGenerativeUI(item).activityType }} — rendered in chat
                    </div>
                  </ng-template>
                </div>
              </ng-container>
            </ng-container>
          </ng-container>

          <!-- ── Agent State tab ── -->
          <ng-container *ngIf="activeTab() === 'agent-state'">
            <div *ngIf="!hasRenderableAgentState()" class="cpk-td__empty-state">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
              </svg>
              <span>No state captured</span>
              <span class="cpk-td__empty-hint"
                >Emitted live from STATE_SNAPSHOT events.</span
              >
            </div>
            <pre
              *ngIf="hasRenderableAgentState()"
              class="cpk-td__json-block"
              [innerHTML]="highlightedJson(agentState())"
            ></pre>
          </ng-container>

          <!-- ── AG-UI Events tab ── -->
          <ng-container *ngIf="activeTab() === 'ag-ui-events'">
            <cpk-empty-events
              *ngIf="aguiEvents().length === 0"
              label="No events captured"
              hint="Events are recorded live. Run the agent to see them here."
            ></cpk-empty-events>
            <div *ngFor="let event of aguiEvents()" class="cpk-td__event">
              <div
                class="cpk-td__event-header"
                [style.background]="evColor(event.type).bg"
              >
                <span
                  class="cpk-td__event-type"
                  [style.color]="evColor(event.type).fg"
                  >{{ event.type }}</span
                >
                <span class="cpk-td__event-time">{{
                  fmtTimestamp(event.timestamp)
                }}</span>
              </div>
              <pre
                class="cpk-td__event-payload"
                [innerHTML]="highlightedJson(event.payload)"
              ></pre>
            </div>
          </ng-container>
        </div>
      </div>

      <!-- ── Tool call template ─────────────────────────────────────────── -->
      <ng-template #toolBlock let-tc>
        <div class="cpk-td__tool-block">
          <div class="cpk-td__tool-header" (click)="toggleToolExpand(tc.id)">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path
                d="M1 9C1 9 2 7 5 7C8 7 9 9 9 9M5 1C5 1 7 2.5 7 4.5C7 6.5 5 7 5 7C5 7 3 6.5 3 4.5C3 2.5 5 1 5 1Z"
                stroke="#189370"
                stroke-width="1.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <span class="cpk-td__tool-name">{{ tc.toolName }}</span>
            <span class="cpk-td__tool-status" *ngIf="tc.result">DONE</span>
            <span
              class="cpk-td__tool-status cpk-td__tool-status--pending"
              *ngIf="!tc.result"
              >PENDING</span
            >
            <span class="cpk-td__tool-chevron">{{
              isToolExpanded(tc.id) ? "▾" : "▸"
            }}</span>
          </div>
          <div class="cpk-td__tool-body" *ngIf="isToolExpanded(tc.id)">
            <div class="cpk-td__tool-section-label">Arguments</div>
            <pre
              class="cpk-td__tool-pre"
              [innerHTML]="highlightedJson(tc.arguments)"
            ></pre>
            <ng-container *ngIf="tc.result">
              <div class="cpk-td__tool-section-label" style="margin-top: 8px">
                Result
              </div>
              <pre
                class="cpk-td__tool-pre"
                [innerHTML]="highlightedJson(tc.result)"
              ></pre>
            </ng-container>
          </div>
        </div>
      </ng-template>

      <!-- ── Resize divider ────────────────────────────────────────────── -->
      <div
        *ngIf="showDetailPanel()"
        class="cpk-td__detail-divider"
        (pointerdown)="onDetailDividerDown($event)"
        (pointermove)="onDetailDividerMove($event)"
        (pointerup)="onDetailDividerUp($event)"
        (pointercancel)="onDetailDividerUp($event)"
      ></div>

      <!-- ── Right metadata panel ──────────────────────────────────────── -->
      <div
        *ngIf="showDetailPanel()"
        class="cpk-td__detail"
        [style.width.px]="detailPanelWidth()"
      >
        <!-- Thread -->
        <div class="cpk-tdp__section-title">Thread</div>
        <div class="cpk-tdp__row">
          <span class="cpk-tdp__label">ID</span>
          <span class="cpk-tdp__value cpk-tdp__value--wrap">{{
            shortId(thread()?.id)
          }}</span>
        </div>
        <div class="cpk-tdp__row">
          <span class="cpk-tdp__label">Name</span>
          <span class="cpk-tdp__value">{{ thread()?.name ?? "—" }}</span>
        </div>
        <div class="cpk-tdp__row">
          <span class="cpk-tdp__label">Agent</span>
          <span class="cpk-tdp__value cpk-tdp__value--truncate">{{
            thread()?.agentId ?? "—"
          }}</span>
        </div>
        <div class="cpk-tdp__row">
          <span class="cpk-tdp__label">Created by</span>
          <span class="cpk-tdp__value cpk-tdp__value--truncate">{{
            thread()?.createdById ?? "—"
          }}</span>
        </div>

        <div class="cpk-tdp__divider"></div>

        <!-- Timestamps -->
        <div class="cpk-tdp__section-title">Timestamps</div>
        <div class="cpk-tdp__row">
          <span class="cpk-tdp__label">Created</span>
          <span class="cpk-tdp__value">{{ fmtTime(thread()?.createdAt) }}</span>
        </div>
        <div class="cpk-tdp__row">
          <span class="cpk-tdp__label">Updated</span>
          <span class="cpk-tdp__value">{{ fmtTime(thread()?.updatedAt) }}</span>
        </div>
        <div class="cpk-tdp__row">
          <span class="cpk-tdp__label">Duration</span>
          <span class="cpk-tdp__value">{{ duration() }}</span>
        </div>

        <div class="cpk-tdp__divider"></div>

        <!-- Activity -->
        <div class="cpk-tdp__section-title">Activity</div>
        <div class="cpk-tdp__row">
          <span class="cpk-tdp__label">Messages</span>
          <span class="cpk-tdp__value">{{ activityCounts().messages }}</span>
        </div>
        <div class="cpk-tdp__row">
          <span class="cpk-tdp__label">Tool calls</span>
          <span class="cpk-tdp__value">{{ activityCounts().toolCalls }}</span>
        </div>
        <div class="cpk-tdp__row">
          <span class="cpk-tdp__label">AG-UI events</span>
          <span class="cpk-tdp__value">{{ aguiEvents().length }}</span>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      @import url("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&family=Spline+Sans+Mono:wght@400;500&display=swap");

      /* ── Root ────────────────────────────────────────────────────────── */
      :host {
        display: flex;
        flex-direction: row;
        overflow: hidden;
      }

      .cpk-td {
        font-family: "Plus Jakarta Sans", sans-serif;
        font-size: 13px;
        display: flex;
        flex-direction: row;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #ffffff;
      }

      /* ── Left area ───────────────────────────────────────────────────── */
      .cpk-td__left {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      /* ── Tab bar header ──────────────────────────────────────────────── */
      .cpk-td__tabs-header {
        padding: 6px 12px 0;
        border-bottom: 1px solid #dbdbe5;
        flex-shrink: 0;
        display: flex;
        align-items: stretch;
      }

      .cpk-td__tab-group {
        display: flex;
        gap: 0;
        margin-bottom: -1px;
      }

      .cpk-td__tab {
        font-family: "Plus Jakarta Sans", sans-serif;
        font-size: 11px;
        font-weight: 500;
        padding: 10px 12px;
        border: none;
        border-bottom: 2px solid transparent;
        cursor: pointer;
        background: transparent;
        color: #838389;
        transition:
          color 0.12s,
          border-color 0.12s;
        white-space: nowrap;
      }

      .cpk-td__tab:hover {
        color: #010507;
      }

      .cpk-td__tab--active {
        color: #010507;
        border-bottom-color: #bec2ff;
      }

      .cpk-td__panel-toggle {
        margin-left: auto;
        margin-right: 8px;
        margin-bottom: 6px;
        align-self: center;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        border: 1px solid #dbdbe5;
        border-radius: 5px;
        background: transparent;
        color: #838389;
        cursor: pointer;
        flex-shrink: 0;
        transition:
          background 0.12s,
          color 0.12s,
          border-color 0.12s;
      }
      .cpk-td__panel-toggle:hover {
        background: #bec2ff1a;
        border-color: #bec2ff;
        color: #57575b;
      }
      .cpk-td__panel-toggle--active {
        background: #bec2ff1a;
        border-color: #bec2ff;
        color: #57575b;
      }

      /* ── Scrollable content ──────────────────────────────────────────── */
      .cpk-td__content {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      /* ── Empty state ─────────────────────────────────────────────────── */
      .cpk-td__empty-state {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        color: #838389;
        font-size: 13px;
        padding: 40px 0;
      }

      .cpk-td__empty-hint {
        font-size: 11px;
        color: #838389;
        text-align: center;
        max-width: 220px;
        line-height: 1.5;
      }

      /* ── Status messages ─────────────────────────────────────────────── */
      .cpk-td__status {
        padding: 16px;
        font-size: 12px;
        color: #838389;
        text-align: center;
      }

      .cpk-td__status--error {
        color: #c0333a;
      }

      /* ── Conversation bubbles ────────────────────────────────────────── */
      .cpk-td__bubble {
        display: flex;
        margin-bottom: 2px;
      }

      .cpk-td__bubble--user {
        justify-content: flex-end;
      }

      .cpk-td__bubble--assistant {
        justify-content: flex-start;
      }

      .cpk-td__bubble-inner {
        padding: 9px 14px;
        max-width: 75%;
        font-size: 13px;
        line-height: 1.55;
      }

      .cpk-td__bubble-inner--user {
        background: #eee6fe;
        color: #57575b;
        border-radius: 10px 10px 3px 10px;
      }

      .cpk-td__show-more {
        display: inline-block;
        margin-top: 4px;
        font-size: 11px;
        font-weight: 500;
        color: #57575b;
        cursor: pointer;
        text-decoration: underline;
        text-underline-offset: 2px;
      }

      .cpk-td__bubble-inner--assistant {
        background: #f7f7f9;
        color: #010507;
        border-radius: 10px 10px 10px 3px;
        border: 1px solid #e9e9ef;
      }

      /* ── Tool call blocks ────────────────────────────────────────────── */
      .cpk-td__tool-block {
        border: 1px solid #e9e9ef;
        border-radius: 6px;
        overflow: hidden;
      }

      .cpk-td__tool-header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        background: rgba(133, 236, 206, 0.15);
        cursor: pointer;
        font-size: 11px;
        user-select: none;
      }

      .cpk-td__tool-header:hover {
        background: rgba(133, 236, 206, 0.22);
      }

      .cpk-td__tool-name {
        font-family: "Spline Sans Mono", monospace;
        font-size: 10px;
        font-weight: 500;
        color: #189370;
        text-transform: uppercase;
        flex: 1;
      }

      .cpk-td__tool-status {
        font-family: "Spline Sans Mono", monospace;
        font-size: 9px;
        text-transform: uppercase;
        color: #189370;
      }

      .cpk-td__tool-status--pending {
        color: #996300;
      }

      .cpk-td__tool-chevron {
        color: #838389;
        font-size: 10px;
      }

      .cpk-td__tool-body {
        padding: 8px 10px;
        border-top: 1px solid #e9e9ef;
        background: #ffffff;
      }

      .cpk-td__tool-section-label {
        font-family: "Spline Sans Mono", monospace;
        font-size: 9px;
        font-weight: 500;
        color: #838389;
        text-transform: uppercase;
        margin-bottom: 4px;
        letter-spacing: 0.3px;
      }

      .cpk-td__tool-pre {
        margin: 0;
        font-family: "Spline Sans Mono", monospace;
        font-size: 10px;
        background: #f7f7f9;
        padding: 6px 8px;
        border-radius: 4px;
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-all;
        color: #010507;
        line-height: 1.6;
      }

      /* ── Tool call group ─────────────────────────────────────────────── */
      .cpk-td__tool-group {
        border: 1px solid #e9e9ef;
        border-radius: 6px;
        overflow: hidden;
      }

      .cpk-td__tool-group-header {
        padding: 5px 10px;
        background: rgba(133, 236, 206, 0.15);
        font-family: "Spline Sans Mono", monospace;
        font-size: 10px;
        color: #189370;
        text-transform: uppercase;
        font-weight: 500;
        border-bottom: 1px solid #e9e9ef;
      }

      .cpk-td__tool-group .cpk-td__tool-block {
        border: none;
        border-bottom: 1px solid #e9e9ef;
        border-radius: 0;
      }

      .cpk-td__tool-group .cpk-td__tool-block:last-child {
        border-bottom: none;
      }

      /* ── Inline chips (reasoning / state update) ─────────────────────── */
      .cpk-td__inline-chip {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 5px 0;
        color: #838389;
        font-family: "Spline Sans Mono", monospace;
        font-size: 9px;
        text-transform: uppercase;
      }

      .cpk-td__inline-chip::before,
      .cpk-td__inline-chip::after {
        content: "";
        flex: 1;
        height: 1px;
        background: #e9e9ef;
      }

      /* ── Generative UI ──────────────────────────────────────────────── */
      @keyframes cpk-genui-enter {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .cpk-td__genui {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 4px 16px 8px;
        animation: cpk-genui-enter 0.25s cubic-bezier(0.16, 1, 0.3, 1) both;
      }

      .cpk-td__genui-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        border-radius: 4px;
        background: #eee6fe;
        color: #57575b;
        font-size: 10px;
        font-weight: 600;
        align-self: flex-start;
      }

      .cpk-td__genui-card {
        overflow: hidden;
        border-radius: 12px;
        border: 1px solid #e2e8f0;
        background: #fff;
        box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.08);
      }

      .cpk-td__genui-placeholder {
        padding: 8px 12px;
        border-radius: 8px;
        border: 1px solid #ede9fe;
        background: #f5f3ff;
        color: #7c3aed;
        font-size: 11px;
      }

      /* ── AG-UI Events ────────────────────────────────────────────────── */
      .cpk-td__event {
        flex-shrink: 0;
        border: 1px solid #e9e9ef;
        border-radius: 6px;
        overflow: hidden;
      }

      .cpk-td__event-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 5px 10px;
      }

      .cpk-td__event-type {
        font-family: "Spline Sans Mono", monospace;
        font-size: 9px;
        font-weight: 500;
        text-transform: uppercase;
      }

      .cpk-td__event-time {
        font-family: "Spline Sans Mono", monospace;
        font-size: 9px;
        color: #838389;
      }

      .cpk-td__event-payload {
        margin: 0;
        font-family: "Spline Sans Mono", monospace;
        font-size: 10px;
        line-height: 1.6;
        white-space: pre-wrap;
        word-break: break-all;
        color: #57575b;
        padding: 8px 10px;
        border-top: 1px solid #e9e9ef;
      }

      /* ── JSON block (agent state) ────────────────────────────────────── */
      .cpk-td__json-block {
        margin: 0;
        font-family: "Spline Sans Mono", monospace;
        font-size: 11px;
        line-height: 1.8;
        white-space: pre-wrap;
        word-break: break-all;
        color: #57575b;
      }

      /* ── Resize divider ──────────────────────────────────────────────── */
      .cpk-td__detail-divider {
        width: 4px;
        flex-shrink: 0;
        cursor: col-resize;
        background: transparent;
        border-left: 1px solid #dbdbe5;
        position: relative;
        z-index: 1;
      }

      .cpk-td__detail-divider:hover {
        background: rgba(190, 194, 255, 0.3);
      }

      /* ── Right detail panel ──────────────────────────────────────────── */
      .cpk-td__detail {
        flex-shrink: 0;
        overflow-y: auto;
        background: #f7f7f9;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 0;
      }

      .cpk-tdp__section-title {
        font-family: "Spline Sans Mono", monospace;
        font-size: 10px;
        font-weight: 500;
        color: #838389;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        margin-bottom: 8px;
      }

      .cpk-tdp__divider {
        height: 1px;
        background: #dbdbe5;
        margin: 14px 0;
      }

      .cpk-tdp__row {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        padding: 3px 0;
        gap: 8px;
      }

      .cpk-tdp__label {
        color: #838389;
        font-size: 11px;
        white-space: nowrap;
        flex-shrink: 0;
      }

      .cpk-tdp__value {
        color: #010507;
        font-family: "Spline Sans Mono", monospace;
        font-size: 11px;
        text-align: right;
        min-width: 0;
      }

      .cpk-tdp__value--truncate {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 130px;
      }

      .cpk-tdp__value--wrap {
        white-space: normal;
        word-break: break-all;
        text-align: right;
      }
    `,
  ],
})
export class ThreadDetailsComponent {
  private sanitizer = inject(DomSanitizer);

  threadId = input<string | null>(null);
  thread = input<InspectorThreadMeta | null>(null);
  runtimeUrl = input<string>("");
  headers = input<Record<string, string>>({});
  /** If provided, used directly instead of fetching from the API. Useful for Storybook. */
  conversationOverride = input<ConversationItem[] | null>(null);
  /** Which tab to show on mount (and after threadId changes). Defaults to "conversation". */
  initialTab = input<Tab>("conversation");
  /** Live agent state from the inspector (keyed by agentId). Null = no state yet. */
  agentStateInput = input<Record<string, unknown> | null>(null, {
    alias: "agentState",
  });
  /** Live AG-UI events from the inspector for this thread's agent. */
  agentEventsInput = input<AgentEvent[]>([], { alias: "agentEvents" });

  readonly TAB_LIST: { id: Tab; label: string }[] = [
    { id: "conversation", label: "Conversation" },
    { id: "agent-state", label: "Agent State" },
    { id: "ag-ui-events", label: "AG-UI Events" },
  ];

  activeTab = signal<Tab>("conversation");
  showDetailPanel = signal(false);
  conversation = signal<ConversationItem[]>([]);
  isLoadingMessages = signal(false);
  messagesError = signal<string | null>(null);

  agentState = computed(() => this.agentStateInput() ?? {});
  aguiEvents = computed(() => this.agentEventsInput());

  // Detail panel resize state
  detailPanelWidth = signal(250);
  private _dividerResizing = false;
  private _dividerPointerId = -1;
  private _dividerStartX = 0;
  private _dividerStartWidth = 0;

  // Inline tool call expand/collapse
  private _expandedToolCalls = signal<Set<string>>(new Set());

  // Long-message collapse
  private _expandedMessages = signal<Set<string>>(new Set());
  readonly COLLAPSE_THRESHOLD = 800;

  private fetchAbortController: AbortController | null = null;

  activityCounts = computed(() => {
    const items = this.conversation();
    let messages = 0;
    let toolCalls = 0;
    let generativeUi = 0;
    for (const item of items) {
      if (item.type === "user" || item.type === "assistant") messages++;
      if (item.type === "tool_call") toolCalls++;
      if (item.type === "generative-ui") generativeUi++;
    }
    return { messages, toolCalls, generativeUi };
  });

  duration = computed(() => {
    const t = this.thread();
    if (!t?.createdAt || !t?.updatedAt) return "—";
    const ms =
      new Date(t.updatedAt).getTime() - new Date(t.createdAt).getTime();
    if (ms < 0) return "—";
    if (ms < 1000) return `${ms}ms`;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rs = s % 60;
    return `${m}m ${rs}s`;
  });

  constructor() {
    // React to live message updates from the inspector
    effect(() => {
      const override = this.conversationOverride();
      if (override !== null) {
        this.conversation.set(override);
      }
    });

    // Fetch from server only when threadId changes and no live data is available
    effect(() => {
      const threadId = this.threadId();
      this.activeTab.set(this.initialTab());
      this._expandedToolCalls.set(new Set());
      this.fetchAbortController?.abort();
      this.fetchAbortController = null;
      if (threadId && untracked(this.conversationOverride) === null) {
        void this.fetchMessages(threadId);
      } else if (!threadId) {
        this.conversation.set([]);
      }
    });
  }

  private async fetchMessages(threadId: string): Promise<void> {
    const override = this.conversationOverride();
    if (override !== null) {
      this.conversation.set(override);
      return;
    }
    const runtimeUrl = this.runtimeUrl();
    if (!runtimeUrl) {
      this.conversation.set([]);
      return;
    }
    const controller = new AbortController();
    this.fetchAbortController = controller;
    this.isLoadingMessages.set(true);
    this.messagesError.set(null);
    try {
      const response = await fetch(
        `${runtimeUrl}/threads/${encodeURIComponent(threadId)}/messages`,
        { headers: { ...this.headers() }, signal: controller.signal },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { messages: ApiThreadMessage[] };
      this.conversation.set(this.mapMessages(data.messages));
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      this.messagesError.set(
        err instanceof Error ? err.message : "Failed to load messages",
      );
      this.conversation.set([]);
    } finally {
      if (!controller.signal.aborted) {
        this.isLoadingMessages.set(false);
      }
    }
  }

  private mapMessages(messages: ApiThreadMessage[]): ConversationItem[] {
    const items: ConversationItem[] = [];
    const toolCallMap = new Map<string, ConversationToolCall>();

    for (const msg of messages) {
      if (msg.role === "user" && msg.content) {
        items.push({
          id: msg.id,
          type: "user",
          content: msg.content,
          createdAt: "",
        });
      } else if (msg.role === "assistant") {
        if (msg.toolCalls?.length) {
          for (const tc of msg.toolCalls) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(tc.args) as Record<string, unknown>;
            } catch {
              // leave empty
            }
            const item: ConversationToolCall = {
              id: tc.id,
              type: "tool_call",
              toolName: tc.name,
              toolCallId: tc.id,
              arguments: args,
              result: null,
              createdAt: "",
            };
            toolCallMap.set(tc.id, item);
            items.push(item);
          }
        }
        if (msg.content) {
          items.push({
            id: msg.id,
            type: "assistant",
            content: msg.content,
            createdAt: "",
          });
        }
      } else if (msg.role === "activity") {
        items.push({
          id: msg.id,
          type: "generative-ui",
          activityType: msg.activityType ?? "unknown",
          createdAt: "",
        });
      } else if (msg.role === "tool" && msg.toolCallId) {
        const tc = toolCallMap.get(msg.toolCallId);
        if (tc) {
          try {
            tc.result = JSON.parse(msg.content ?? "{}") as Record<
              string,
              unknown
            >;
          } catch {
            tc.result = {};
          }
        }
      }
    }

    return items;
  }

  get renderItems(): RenderItem[] {
    const items = this.conversation();
    const result: RenderItem[] = [];
    const seen = new Set<string>();

    for (const item of items) {
      if (item.type === "agent_responded") continue;
      if (item.type !== "tool_call" || !item.groupId) {
        result.push(item);
        continue;
      }
      if (seen.has(item.groupId)) continue;
      seen.add(item.groupId);
      const group: ToolCallGroup = {
        type: "tool_call_group",
        id: item.groupId,
        items: items.filter(
          (i): i is ConversationToolCall =>
            i.type === "tool_call" && i.groupId === item.groupId,
        ),
      };
      result.push(group);
    }
    return result;
  }

  hasRenderableAgentState(): boolean {
    const state = this.agentState();
    return (
      state !== null &&
      state !== undefined &&
      typeof state === "object" &&
      Object.keys(state).length > 0
    );
  }

  // ── Inline tool expand/collapse ──────────────────────────────────────────

  isToolExpanded(id: string): boolean {
    return this._expandedToolCalls().has(id);
  }

  toggleToolExpand(id: string): void {
    const s = new Set(this._expandedToolCalls());
    if (s.has(id)) {
      s.delete(id);
    } else {
      s.add(id);
    }
    this._expandedToolCalls.set(s);
  }

  isMessageExpanded(id: string): boolean {
    return this._expandedMessages().has(id);
  }

  toggleMessage(id: string): void {
    const s = new Set(this._expandedMessages());
    if (s.has(id)) {
      s.delete(id);
    } else {
      s.add(id);
    }
    this._expandedMessages.set(s);
  }

  // ── Detail panel resize ──────────────────────────────────────────────────

  onDetailDividerDown(event: PointerEvent): void {
    this._dividerResizing = true;
    this._dividerPointerId = event.pointerId;
    this._dividerStartX = event.clientX;
    this._dividerStartWidth = this.detailPanelWidth();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  onDetailDividerMove(event: PointerEvent): void {
    if (!this._dividerResizing || this._dividerPointerId !== event.pointerId)
      return;
    const delta = this._dividerStartX - event.clientX;
    this.detailPanelWidth.set(
      Math.max(160, Math.min(400, this._dividerStartWidth + delta)),
    );
  }

  onDetailDividerUp(event: PointerEvent): void {
    if (this._dividerPointerId !== event.pointerId) return;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(this._dividerPointerId)) {
      target.releasePointerCapture(this._dividerPointerId);
    }
    this._dividerResizing = false;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  shortId(id: string | null | undefined): string {
    if (!id) return "—";
    return id.length > 20 ? id.slice(0, 8) + "…" : id;
  }

  fmtTime(dateStr: string | null | undefined): string {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }

  fmtTimestamp(ts: string | number): string {
    const date = typeof ts === "number" ? new Date(ts) : new Date(ts);
    const ms = date.getMilliseconds().toString().padStart(3, "0");
    return (
      date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }) +
      "." +
      ms
    );
  }

  evColor(type: string): { bg: string; fg: string } {
    if (type.startsWith("TEXT_MESSAGE"))
      return { bg: "#EEE6FE", fg: "#57575B" };
    if (type.startsWith("TOOL_CALL"))
      return { bg: "rgba(133,236,206,0.15)", fg: "#189370" };
    if (type.startsWith("STATE"))
      return { bg: "rgba(190,194,255,0.102)", fg: "#5558B2" };
    if (type.startsWith("RUN_") || type.startsWith("STEP_"))
      return { bg: "rgba(255,172,77,0.2)", fg: "#996300" };
    if (type === "ERROR") return { bg: "rgba(250,95,103,0.13)", fg: "#c0333a" };
    return { bg: "#F7F7F9", fg: "#838389" };
  }

  // Cast helpers — Angular templates don't narrow union types
  asUser(item: RenderItem): ConversationUser {
    return item as ConversationUser;
  }

  asAssistant(item: RenderItem): ConversationAssistant {
    return item as ConversationAssistant;
  }

  asToolCall(item: RenderItem): ConversationToolCall {
    return item as ConversationToolCall;
  }

  asToolCallGroup(item: RenderItem): ToolCallGroup {
    return item as ToolCallGroup;
  }

  asReasoning(item: RenderItem): ConversationReasoning {
    return item as ConversationReasoning;
  }

  asGenerativeUI(item: RenderItem): ConversationGenerativeUI {
    return item as ConversationGenerativeUI;
  }

  // Safe for demo/scripted HTML only — never called with raw user-controlled content.
  safeGenerativeUiHtml(item: ConversationGenerativeUI): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(item.html ?? "");
  }

  // JSON syntax highlighter. Uses inline styles so Angular's ViewEncapsulation
  // doesn't strip the classes from innerHTML-injected nodes.
  // Safe to use bypassSecurityTrustHtml here — input is always structured data
  // from the store (never raw user-controlled HTML).
  highlightedJson(obj: unknown): SafeHtml {
    const colors: Record<string, string> = {
      key: "#5558B2",
      str: "#189370",
      num: "#996300",
      bool: "#c0333a",
      nil: "#838389",
    };

    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const json = JSON.stringify(obj, null, 2);
    const parts: string[] = [];
    let lastIndex = 0;
    const re =
      /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g;
    let match: RegExpExecArray | null;

    while ((match = re.exec(json)) !== null) {
      parts.push(esc(json.slice(lastIndex, match.index)));
      const m = match[0];
      let color = colors.num;
      if (/^"/.test(m)) {
        color = /:$/.test(m) ? colors.key : colors.str;
      } else if (m === "true" || m === "false") {
        color = colors.bool;
      } else if (m === "null") {
        color = colors.nil;
      }
      parts.push(`<span style="color:${color}">${esc(m)}</span>`);
      lastIndex = match.index + m.length;
    }
    parts.push(esc(json.slice(lastIndex)));

    return this.sanitizer.bypassSecurityTrustHtml(parts.join(""));
  }
}
