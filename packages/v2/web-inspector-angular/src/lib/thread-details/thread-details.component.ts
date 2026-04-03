import {
  Component,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  ElementRef,
  input,
  effect,
  signal,
  computed,
  inject,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { DomSanitizer, SafeHtml } from "@angular/platform-browser";

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

export type ConversationItem =
  | ConversationUser
  | ConversationAssistant
  | ConversationToolCall
  | ConversationReasoning
  | ConversationStateUpdate
  | ConversationAgentResponded;

export interface FakeAguiEvent {
  type: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

// ---- Fake data (agent state + AG-UI events remain static until live data is wired) --

const FAKE_AGENT_STATE = {
  thread_id: "c2f262b8-4b3e-4d9e-9d7c-8348c8cc0f67",
  agent: "default",
  status: "idle",
  state: {
    topic: "future of AI",
    sources_searched: ["web", "image", "video", "news"],
    response_ready: true,
    last_query: "Pulumi enterprise adoption 2025 developer sentiment",
  },
};

const FAKE_AGUI_EVENTS: FakeAguiEvent[] = [
  {
    type: "RUN_STARTED",
    timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    payload: {
      run_id: "run-aaa",
      thread_id: "c2f262b8-4b3e-4d9e-9d7c-8348c8cc0f67",
    },
  },
  {
    type: "TEXT_MESSAGE_START",
    timestamp: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
    payload: { message_id: "item-1", role: "user" },
  },
  {
    type: "TOOL_CALL_START",
    timestamp: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
    payload: { tool_call_id: "call_01J9Z4X8W2Y7TQ", tool_name: "web_search" },
  },
  {
    type: "TOOL_CALL_RESULT",
    timestamp: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
    payload: {
      tool_call_id: "call_01J9Z4X8W2Y7TQ",
      status: "success",
      latency_ms: 842,
    },
  },
  {
    type: "STATE_SNAPSHOT",
    timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    payload: {
      topic: "future of AI",
      sources_searched: ["web", "image", "video", "news"],
    },
  },
  {
    type: "TEXT_MESSAGE_START",
    timestamp: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    payload: { message_id: "item-9", role: "assistant" },
  },
  {
    type: "RUN_FINISHED",
    timestamp: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    payload: { run_id: "run-aaa", status: "success" },
  },
];

// ---- Component --------------------------------------------------------------

type Tab = "conversation" | "agent-state" | "ag-ui-events";

@Component({
  selector: "cpk-thread-details",
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.ShadowDom,
  template: `
    <div class="cpk-td" [class.cpk-td--split]="selectedToolCall()">
      <!-- ── Main panel ──────────────────────────────────────────────── -->
      <div class="cpk-td__main">
        <!-- Header -->
        <div class="cpk-td__header">
          <span class="cpk-td__title">
            Thread Details<ng-container *ngIf="thread()?.name"
              >: {{ thread()?.name }}</ng-container
            >
          </span>
          <button class="cpk-td__close" (click)="onClose()" aria-label="Close">
            ×
          </button>
        </div>

        <!-- Metadata -->
        <div class="cpk-td__meta">
          <div class="cpk-td__meta-row">
            <span class="cpk-td__meta-label">Title</span>
            <span class="cpk-td__meta-value">{{
              thread()?.name ?? "Untitled"
            }}</span>
          </div>
          <div class="cpk-td__meta-row">
            <span class="cpk-td__meta-label">Created</span>
            <span class="cpk-td__meta-value">{{
              thread()?.createdAt | date: "MMMM d, y 'at' h:mm a"
            }}</span>
          </div>
          <div class="cpk-td__meta-row">
            <span class="cpk-td__meta-label">Updated</span>
            <span class="cpk-td__meta-value">{{
              thread()?.updatedAt | date: "MMMM d, y 'at' h:mm a"
            }}</span>
          </div>
          <div class="cpk-td__meta-row">
            <span class="cpk-td__meta-label">Agent ID</span>
            <span class="cpk-td__meta-value">{{ thread()?.agentId }}</span>
          </div>
          <div class="cpk-td__meta-row">
            <span class="cpk-td__meta-label">Created By</span>
            <span class="cpk-td__meta-value cpk-td__meta-value--truncate">{{
              thread()?.createdById
            }}</span>
          </div>
        </div>

        <!-- Tab bar -->
        <div class="cpk-td__tabs" role="tablist">
          <button
            *ngFor="let tab of TAB_LIST"
            role="tab"
            class="cpk-td__tab"
            [class.cpk-td__tab--active]="activeTab() === tab.id"
            (click)="activeTab.set(tab.id); selectedToolCallId.set(null)"
          >
            {{ tab.label }}
          </button>
        </div>

        <!-- Content -->
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
            <div *ngFor="let item of renderItems" class="cpk-td__item">
              <ng-container *ngIf="item.type === 'user'">
                <div class="cpk-td__user-bubble">{{ item.content }}</div>
              </ng-container>

              <ng-container *ngIf="item.type === 'tool_call'">
                <ng-container
                  *ngTemplateOutlet="
                    toolChip;
                    context: { $implicit: asToolCall(item) }
                  "
                ></ng-container>
              </ng-container>

              <ng-container *ngIf="item.type === 'tool_call_group'">
                <div class="cpk-td__tool-group">
                  <ng-container *ngFor="let tc of asToolCallGroup(item).items">
                    <ng-container
                      *ngTemplateOutlet="toolChip; context: { $implicit: tc }"
                    ></ng-container>
                  </ng-container>
                </div>
              </ng-container>

              <ng-container *ngIf="item.type === 'reasoning'">
                <div class="cpk-td__chip cpk-td__chip--meta">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <mask
                      id="mask0_79_1337"
                      style="mask-type: alpha"
                      maskUnits="userSpaceOnUse"
                      x="0"
                      y="0"
                      width="14"
                      height="14"
                    >
                      <rect width="14" height="14" fill="#D9D9D9" />
                    </mask>
                    <g mask="url(#mask0_79_1337)">
                      <path
                        d="M5.6875 12.25C5.19167 12.25 4.76389 12.0774 4.40417 11.7323C4.04444 11.3872 3.84028 10.9715 3.79167 10.4854C3.20833 10.4076 2.72222 10.15 2.33333 9.7125C1.94444 9.275 1.75 8.75972 1.75 8.16667C1.75 7.9625 1.77674 7.76076 1.83021 7.56146C1.88368 7.36215 1.96389 7.175 2.07083 7C1.96389 6.825 1.88368 6.64028 1.83021 6.44583C1.77674 6.25139 1.75 6.04722 1.75 5.83333C1.75 5.24028 1.94444 4.72743 2.33333 4.29479C2.72222 3.86215 3.20347 3.60694 3.77708 3.52917C3.80625 3.03333 4.00556 2.61285 4.375 2.26771C4.74444 1.92257 5.18194 1.75 5.6875 1.75C5.94028 1.75 6.17604 1.79861 6.39479 1.89583C6.61354 1.99306 6.81528 2.12431 7 2.28958C7.175 2.12431 7.37431 1.99306 7.59792 1.89583C7.82153 1.79861 8.05972 1.75 8.3125 1.75C8.81806 1.75 9.25312 1.92014 9.61771 2.26042C9.98229 2.60069 10.1792 3.01875 10.2083 3.51458C10.7819 3.59236 11.2656 3.85 11.6594 4.2875C12.0531 4.725 12.25 5.24028 12.25 5.83333C12.25 6.04722 12.2233 6.25139 12.1698 6.44583C12.1163 6.64028 12.0361 6.825 11.9292 7C12.0361 7.175 12.1163 7.36215 12.1698 7.56146C12.2233 7.76076 12.25 7.9625 12.25 8.16667C12.25 8.76944 12.0531 9.28715 11.6594 9.71979C11.2656 10.1524 10.7771 10.4076 10.1938 10.4854C10.1451 10.9715 9.9434 11.3872 9.58854 11.7323C9.23368 12.0774 8.80833 12.25 8.3125 12.25C8.06944 12.25 7.83368 12.2038 7.60521 12.1115C7.37674 12.0191 7.175 11.8903 7 11.725C6.81528 11.8903 6.61111 12.0191 6.3875 12.1115C6.16389 12.2038 5.93056 12.25 5.6875 12.25ZM7.58333 3.64583V10.3542C7.58333 10.5583 7.65382 10.7309 7.79479 10.8719C7.93576 11.0128 8.10833 11.0833 8.3125 11.0833C8.50694 11.0833 8.67465 11.0056 8.81562 10.85C8.9566 10.6944 9.03194 10.5194 9.04167 10.325C8.8375 10.2472 8.65035 10.1427 8.48021 10.0115C8.31007 9.88021 8.15694 9.72222 8.02083 9.5375C7.92361 9.40139 7.88715 9.25556 7.91146 9.1C7.93576 8.94444 8.01597 8.81806 8.15208 8.72083C8.28819 8.62361 8.43403 8.58715 8.58958 8.61146C8.74514 8.63576 8.87153 8.71597 8.96875 8.85208C9.07569 9.00764 9.21181 9.12674 9.37708 9.20937C9.54236 9.29201 9.72222 9.33333 9.91667 9.33333C10.2375 9.33333 10.5122 9.2191 10.7406 8.99062C10.9691 8.76215 11.0833 8.4875 11.0833 8.16667C11.0833 8.11806 11.0809 8.06944 11.076 8.02083C11.0712 7.97222 11.059 7.92361 11.0396 7.875C10.8743 7.97222 10.6969 8.04514 10.5073 8.09375C10.3177 8.14236 10.1208 8.16667 9.91667 8.16667C9.75139 8.16667 9.61285 8.11076 9.50104 7.99896C9.38924 7.88715 9.33333 7.74861 9.33333 7.58333C9.33333 7.41806 9.38924 7.27951 9.50104 7.16771C9.61285 7.0559 9.75139 7 9.91667 7C10.2375 7 10.5122 6.88576 10.7406 6.65729C10.9691 6.42882 11.0833 6.15417 11.0833 5.83333C11.0833 5.5125 10.9691 5.24028 10.7406 5.01667C10.5122 4.79306 10.2375 4.67639 9.91667 4.66667C9.80972 4.84167 9.67118 4.99479 9.50104 5.12604C9.3309 5.25729 9.14375 5.36181 8.93958 5.43958C8.78403 5.49792 8.63333 5.49306 8.4875 5.425C8.34167 5.35694 8.24444 5.24514 8.19583 5.08958C8.14722 4.93403 8.15451 4.78333 8.21771 4.6375C8.2809 4.49167 8.39028 4.39444 8.54583 4.34583C8.69167 4.29722 8.81076 4.20972 8.90312 4.08333C8.99549 3.95694 9.04167 3.81111 9.04167 3.64583C9.04167 3.44167 8.97118 3.2691 8.83021 3.12812C8.68924 2.98715 8.51667 2.91667 8.3125 2.91667C8.10833 2.91667 7.93576 2.98715 7.79479 3.12812C7.65382 3.2691 7.58333 3.44167 7.58333 3.64583ZM6.41667 10.3542V3.64583C6.41667 3.44167 6.34618 3.2691 6.20521 3.12812C6.06424 2.98715 5.89167 2.91667 5.6875 2.91667C5.48333 2.91667 5.31076 2.98715 5.16979 3.12812C5.02882 3.2691 4.95833 3.44167 4.95833 3.64583C4.95833 3.80139 5.00208 3.94479 5.08958 4.07604C5.17708 4.20729 5.29375 4.29722 5.43958 4.34583C5.59514 4.39444 5.70694 4.49167 5.775 4.6375C5.84306 4.78333 5.85278 4.93403 5.80417 5.08958C5.74583 5.24514 5.64375 5.35694 5.49792 5.425C5.35208 5.49306 5.20139 5.49792 5.04583 5.43958C4.84167 5.36181 4.65451 5.25729 4.48438 5.12604C4.31424 4.99479 4.17569 4.84167 4.06875 4.66667C3.75764 4.67639 3.48785 4.79549 3.25937 5.02396C3.0309 5.25243 2.91667 5.52222 2.91667 5.83333C2.91667 6.15417 3.0309 6.42882 3.25937 6.65729C3.48785 6.88576 3.7625 7 4.08333 7C4.24861 7 4.38715 7.0559 4.49896 7.16771C4.61076 7.27951 4.66667 7.41806 4.66667 7.58333C4.66667 7.74861 4.61076 7.88715 4.49896 7.99896C4.38715 8.11076 4.24861 8.16667 4.08333 8.16667C3.87917 8.16667 3.68229 8.14236 3.49271 8.09375C3.30312 8.04514 3.12569 7.97222 2.96042 7.875C2.94097 7.92361 2.92882 7.97222 2.92396 8.02083C2.9191 8.06944 2.91667 8.11806 2.91667 8.16667C2.91667 8.4875 3.0309 8.76215 3.25937 8.99062C3.48785 9.2191 3.7625 9.33333 4.08333 9.33333C4.27778 9.33333 4.45764 9.29201 4.62292 9.20937C4.78819 9.12674 4.92431 9.00764 5.03125 8.85208C5.12847 8.71597 5.25486 8.63576 5.41042 8.61146C5.56597 8.58715 5.71181 8.62361 5.84792 8.72083C5.98403 8.81806 6.06424 8.94444 6.08854 9.1C6.11285 9.25556 6.07639 9.40139 5.97917 9.5375C5.84306 9.72222 5.6875 9.88264 5.5125 10.0188C5.3375 10.1549 5.14792 10.2618 4.94375 10.3396C4.95347 10.534 5.03125 10.7066 5.17708 10.8573C5.32292 11.008 5.49306 11.0833 5.6875 11.0833C5.89167 11.0833 6.06424 11.0128 6.20521 10.8719C6.34618 10.7309 6.41667 10.5583 6.41667 10.3542Z"
                        fill="#181C1F"
                        fill-opacity="0.88"
                      />
                    </g>
                  </svg>
                  Reasoned for {{ asReasoning(item).duration }}
                </div>
              </ng-container>

              <ng-container *ngIf="item.type === 'state_update'">
                <div class="cpk-td__chip cpk-td__chip--meta">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <mask
                      id="mask0_79_1343"
                      style="mask-type: alpha"
                      maskUnits="userSpaceOnUse"
                      x="0"
                      y="0"
                      width="14"
                      height="14"
                    >
                      <rect width="14" height="14" fill="#D9D9D9" />
                    </mask>
                    <g mask="url(#mask0_79_1343)">
                      <path
                        d="M8.1665 11.6666V10.5H9.9165C10.0818 10.5 10.2203 10.4441 10.3321 10.3323C10.4439 10.2205 10.4998 10.0819 10.4998 9.91665V8.74998C10.4998 8.38054 10.6068 8.04512 10.8207 7.74373C11.0346 7.44234 11.3165 7.22845 11.6665 7.10206V6.8979C11.3165 6.77151 11.0346 6.55762 10.8207 6.25623C10.6068 5.95484 10.4998 5.61942 10.4998 5.24998V4.08331C10.4998 3.91804 10.4439 3.77949 10.3321 3.66769C10.2203 3.55588 10.0818 3.49998 9.9165 3.49998H8.1665V2.33331H9.9165C10.4026 2.33331 10.8158 2.50345 11.1561 2.84373C11.4964 3.18401 11.6665 3.5972 11.6665 4.08331V5.24998C11.6665 5.41526 11.7224 5.5538 11.8342 5.6656C11.946 5.77741 12.0846 5.83331 12.2498 5.83331H12.8332V8.16665H12.2498C12.0846 8.16665 11.946 8.22255 11.8342 8.33435C11.7224 8.44616 11.6665 8.5847 11.6665 8.74998V9.91665C11.6665 10.4028 11.4964 10.816 11.1561 11.1562C10.8158 11.4965 10.4026 11.6666 9.9165 11.6666H8.1665ZM4.08317 11.6666C3.59706 11.6666 3.18387 11.4965 2.84359 11.1562C2.50331 10.816 2.33317 10.4028 2.33317 9.91665V8.74998C2.33317 8.5847 2.27727 8.44616 2.16546 8.33435C2.05366 8.22255 1.91512 8.16665 1.74984 8.16665H1.1665V5.83331H1.74984C1.91512 5.83331 2.05366 5.77741 2.16546 5.6656C2.27727 5.5538 2.33317 5.41526 2.33317 5.24998V4.08331C2.33317 3.5972 2.50331 3.18401 2.84359 2.84373C3.18387 2.50345 3.59706 2.33331 4.08317 2.33331H5.83317V3.49998H4.08317C3.91789 3.49998 3.77935 3.55588 3.66755 3.66769C3.55574 3.77949 3.49984 3.91804 3.49984 4.08331V5.24998C3.49984 5.61942 3.39289 5.95484 3.179 6.25623C2.96512 6.55762 2.68317 6.77151 2.33317 6.8979V7.10206C2.68317 7.22845 2.96512 7.44234 3.179 7.74373C3.39289 8.04512 3.49984 8.38054 3.49984 8.74998V9.91665C3.49984 10.0819 3.55574 10.2205 3.66755 10.3323C3.77935 10.4441 3.91789 10.5 4.08317 10.5H5.83317V11.6666H4.08317Z"
                        fill="#1C1B1F"
                      />
                    </g>
                  </svg>
                  Updated Agent State
                </div>
              </ng-container>

              <ng-container *ngIf="item.type === 'assistant'">
                <div class="cpk-td__agent-response">
                  <div class="cpk-td__agent-responded">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <mask
                        id="mask0_82_1357"
                        style="mask-type: alpha"
                        maskUnits="userSpaceOnUse"
                        x="0"
                        y="0"
                        width="14"
                        height="14"
                      >
                        <rect width="14" height="14" fill="#D9D9D9" />
                      </mask>
                      <g mask="url(#mask0_82_1357)">
                        <path
                          d="M2.91667 12.25C2.59583 12.25 2.32118 12.1358 2.09271 11.9073C1.86424 11.6788 1.75 11.4042 1.75 11.0833V2.91667C1.75 2.59583 1.86424 2.32118 2.09271 2.09271C2.32118 1.86424 2.59583 1.75 2.91667 1.75H11.0833C11.4042 1.75 11.6788 1.86424 11.9073 2.09271C12.1358 2.32118 12.25 2.59583 12.25 2.91667V11.0833C12.25 11.4042 12.1358 11.6788 11.9073 11.9073C11.6788 12.1358 11.4042 12.25 11.0833 12.25H2.91667ZM2.91667 11.0833H11.0833V9.33333H9.33333C9.04167 9.70278 8.6941 9.98958 8.29063 10.1938C7.88715 10.3979 7.45694 10.5 7 10.5C6.54306 10.5 6.11285 10.3979 5.70937 10.1938C5.3059 9.98958 4.95833 9.70278 4.66667 9.33333H2.91667V11.0833ZM8.00625 9.0125C8.30764 8.79861 8.51667 8.51667 8.63333 8.16667H11.0833V2.91667H2.91667V8.16667H5.36667C5.48333 8.51667 5.69236 8.79861 5.99375 9.0125C6.29514 9.22639 6.63056 9.33333 7 9.33333C7.36944 9.33333 7.70486 9.22639 8.00625 9.0125ZM4.08333 7.14583H9.91667V5.97917H4.08333V7.14583ZM4.08333 5.10417H9.91667V3.9375H4.08333V5.10417Z"
                          fill="#1C1B1F"
                          fill-opacity="0.88"
                        />
                      </g>
                    </svg>
                    Agent Responded
                  </div>
                  <p class="cpk-td__assistant-msg">{{ item.content }}</p>
                </div>
              </ng-container>
            </div>
          </ng-container>

          <ng-template #toolChip let-tc>
            <button
              class="cpk-td__chip cpk-td__chip--tool"
              [class.cpk-td__chip--active]="selectedToolCallId() === tc.id"
              (click)="selectToolCall(tc.id)"
            >
              <svg
                width="8"
                height="9"
                viewBox="0 0 8 9"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M3 9C2.85833 9 2.73958 8.95208 2.64375 8.85625C2.54792 8.76042 2.5 8.64167 2.5 8.5V2.5H0C0 1.80833 0.24375 1.21875 0.73125 0.73125C1.21875 0.24375 1.80833 0 2.5 0H5.5V1.5L7 0H8V4H7L5.5 2.5V8.5C5.5 8.64167 5.45208 8.76042 5.35625 8.85625C5.26042 8.95208 5.14167 9 5 9H3ZM3.5 8H4.5V5H3.5V8ZM3.5 4H4.5V1H2.5C2.28333 1 2.07917 1.04375 1.8875 1.13125C1.69583 1.21875 1.52917 1.34167 1.3875 1.5H3.5V4Z"
                  fill="#181C1F"
                  fill-opacity="0.88"
                />
              </svg>
              Called "{{ tc.toolName }}"
            </button>
          </ng-template>

          <!-- ── Agent State tab ── -->
          <ng-container *ngIf="activeTab() === 'agent-state'">
            <pre
              class="cpk-td__json"
              [innerHTML]="highlightedJson(agentState)"
            ></pre>
          </ng-container>

          <!-- ── AG-UI Events tab ── -->
          <ng-container *ngIf="activeTab() === 'ag-ui-events'">
            <div *ngFor="let event of aguiEvents" class="cpk-td__event">
              <div class="cpk-td__event-header">
                <span class="cpk-td__event-type">{{ event.type }}</span>
                <span class="cpk-td__event-time">{{
                  event.timestamp | date: "shortTime"
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

      <!-- ── Tool call side panel ────────────────────────────────────── -->
      <div class="cpk-td__tool-panel" *ngIf="selectedToolCall()">
        <div class="cpk-td__header">
          <span class="cpk-td__title"
            >Tool Call: {{ selectedToolCall().toolName }}</span
          >
          <button
            class="cpk-td__close"
            (click)="selectedToolCallId.set(null)"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div class="cpk-td__tool-content">
          <div class="cpk-td__tool-section">
            <div class="cpk-td__tool-meta-label">Tool Call ID</div>
            <div class="cpk-td__tool-meta-value">
              {{ selectedToolCall().toolCallId }}
            </div>
          </div>
          <div class="cpk-td__tool-section">
            <div class="cpk-td__tool-section-label">Arguments</div>
            <pre
              class="cpk-td__json"
              [innerHTML]="highlightedJson(selectedToolCall().arguments)"
            ></pre>
          </div>
          <div class="cpk-td__tool-section" *ngIf="selectedToolCall().result">
            <div class="cpk-td__tool-section-label">Result</div>
            <pre
              class="cpk-td__json"
              [innerHTML]="highlightedJson(selectedToolCall().result)"
            ></pre>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      @import url("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600&family=Spline+Sans+Mono:wght@600&display=swap");

      /* ── Root ────────────────────────────────────────────────────────── */
      .cpk-td {
        font-family: "Plus Jakarta Sans", sans-serif;
        font-size: 13px;
        display: flex;
        flex-direction: row;
        border-radius: 12px;
        overflow: hidden;
        border-left: 1px solid #ffffffb8;
        backdrop-filter: blur(24px);
        box-shadow: 0px 4px 8px 0px #00000014;
        background: #ffffff;
      }

      /* ── Main panel ──────────────────────────────────────────────────── */
      .cpk-td__main {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        container-type: inline-size;
      }

      /* ── Tool call side panel ────────────────────────────────────────── */
      .cpk-td__tool-panel {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        border-left: 1px solid rgba(0, 0, 0, 0.08);
      }

      .cpk-td__tool-content {
        flex: 1;
        overflow-y: auto;
        padding: 24px 16px 16px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .cpk-td__tool-section {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .cpk-td__tool-section + .cpk-td__tool-section {
        margin-top: 16px;
      }

      .cpk-td__tool-meta-label {
        font-family: "Plus Jakarta Sans", sans-serif;
        font-size: 11px;
        font-weight: 600;
        line-height: 1;
        color: #181c1f;
      }

      .cpk-td__tool-meta-value {
        font-family: monospace;
        font-size: 12px;
        color: #181c1f;
      }

      .cpk-td__tool-section-label {
        font-family: "Plus Jakarta Sans", sans-serif;
        font-size: 11px;
        font-weight: 600;
        line-height: 1;
        color: #181c1f;
      }

      /* ── Header ──────────────────────────────────────────────────────── */
      .cpk-td__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 16px;
        height: 46px;
        background: #e8edf5;
        border-bottom: 1px solid #00000014;
        flex-shrink: 0;
      }

      .cpk-td__title {
        font-family: "Plus Jakarta Sans", sans-serif;
        font-size: 11px;
        font-weight: 600;
        line-height: 1;
        letter-spacing: 0;
        color: #181c1f;
      }

      .cpk-td__close {
        background: none;
        border: none;
        cursor: pointer;
        font-size: 22px;
        line-height: 1;
        color: #181c1f;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        padding: 0;
      }
      .cpk-td__close:hover {
        background: rgba(0, 0, 0, 0.06);
        color: #181c1f;
      }

      /* ── Metadata ────────────────────────────────────────────────────── */
      .cpk-td__meta {
        border-bottom: 1px solid #00000014;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding-top: 12px;
        padding-bottom: 12px;
      }

      .cpk-td__meta-row {
        display: grid;
        grid-template-columns: 90px 1fr;
        gap: 8px;
        align-items: center;
        height: 32px;
        padding: 8px 8px 8px 16px;
        box-sizing: border-box;
      }

      .cpk-td__meta-label {
        font-family: "Plus Jakarta Sans", sans-serif;
        font-size: 11px;
        font-weight: 600;
        line-height: 1;
        letter-spacing: 0;
        color: #181c1f;
        flex-shrink: 0;
      }

      .cpk-td__meta-value {
        font-family: "Plus Jakarta Sans", sans-serif;
        font-size: 13px;
        font-weight: 400;
        line-height: 1;
        letter-spacing: 0;
        color: #181c1f;
      }

      .cpk-td__meta-value--truncate {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* ── Tabs ────────────────────────────────────────────────────────── */
      .cpk-td__tabs {
        display: flex;
        gap: 4px;
        padding: 8px 12px;
        border-bottom: 1px solid #00000014;
        flex-shrink: 0;
      }

      .cpk-td__tab {
        padding: 8px 12px;
        height: 30px;
        border: none;
        background: none;
        cursor: pointer;
        font-family: "Plus Jakarta Sans", sans-serif;
        font-size: 11px;
        font-weight: 600;
        line-height: 1;
        letter-spacing: 0;
        color: #181c1f;
        border-radius: 8px;
        white-space: nowrap;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .cpk-td__tab:hover {
        color: #181c1f;
        background: rgba(0, 0, 0, 0.04);
      }

      .cpk-td__tab--active {
        background: rgba(117, 124, 242, 0.16);
        color: #181c1f;
        font-weight: 600;
      }

      /* ── Content area ────────────────────────────────────────────────── */
      .cpk-td__content {
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      /* ── Conversation items ──────────────────────────────────────────── */
      .cpk-td__item {
        display: flex;
      }

      /* User bubble — right-aligned */
      .cpk-td__user-bubble {
        margin-left: auto;
        max-width: 240px;
        background: rgba(225, 225, 225, 0.32);
        border-radius: 8px;
        padding: 12px 16px;
        font-size: 13px;
        color: #181c1f;
        line-height: 1.5;
      }

      /* Tool call group with bracketed left border */
      .cpk-td__tool-group {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding-left: 16px;
        margin-left: 8px;
      }

      .cpk-td__tool-group::before {
        content: "";
        position: absolute;
        left: 0;
        top: 8px;
        bottom: 8px;
        width: 8px;
        border-width: 1px 0 1px 1px;
        border-style: solid;
        border-color: #0000001f;
        border-top-left-radius: 8px;
        border-bottom-left-radius: 8px;
      }

      /* Chips */
      .cpk-td__chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        height: 28px;
        box-sizing: border-box;
        border-radius: 8px;
        font-family: "Spline Sans Mono", monospace;
        font-size: 10px;
        font-weight: 600;
        line-height: 1;
        letter-spacing: 0;
        border: 1px solid #00000014;
        background: #ffffff;
        color: rgba(24, 28, 31, 0.64);
        cursor: default;
      }

      .cpk-td__chip--tool {
        cursor: pointer;
      }

      .cpk-td__chip--tool:hover:not(.cpk-td__chip--active) {
        background: rgba(117, 124, 242, 0.06);
        border-color: rgba(117, 124, 242, 0.3);
      }

      .cpk-td__chip--active {
        background: #757cf2;
        color: #ffffff;
        border-color: #757cf2;
      }

      .cpk-td__chip-icon {
        flex-shrink: 0;
        opacity: 0.64;
      }

      .cpk-td__chip--active .cpk-td__chip-icon {
        opacity: 1;
      }

      /* Agent response container */
      .cpk-td__agent-response {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        border: 1px solid #00000014;
        border-radius: 8px;
        width: 100%;
        box-sizing: border-box;
      }

      /* "Agent Responded" label */
      .cpk-td__agent-responded {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-family: "Spline Sans Mono", monospace;
        font-size: 10px;
        font-weight: 600;
        line-height: 1;
        letter-spacing: 0;
        color: rgba(24, 28, 31, 0.64);
      }

      .cpk-td__agent-responded .cpk-td__chip-icon {
        opacity: 0.48;
      }

      /* Assistant message */
      .cpk-td__assistant-msg {
        margin: 0;
        font-size: 13px;
        color: #181c1f;
        line-height: 1.6;
      }

      /* ── JSON block (shared by tool panel + agent state + ag-ui events) */
      .cpk-td__json {
        margin: 0;
        font-family: "Spline Sans Mono", monospace;
        font-weight: 500;
        font-size: 12px;
        line-height: 1.8;
        white-space: pre-wrap;
        word-break: break-all;
        color: #374151;
      }

      /* ── AG-UI Events ────────────────────────────────────────────────── */
      .cpk-td__event {
        flex-shrink: 0;
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 8px;
        overflow: hidden;
      }

      .cpk-td__event-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 12px;
        background: rgba(232, 237, 245, 0.6);
      }

      .cpk-td__event-type {
        font-family: "Fira Code", "Cascadia Code", ui-monospace, monospace;
        font-size: 11px;
        font-weight: 600;
        color: #5558cc;
      }

      .cpk-td__event-time {
        font-size: 11px;
        color: rgba(24, 28, 31, 0.4);
      }

      .cpk-td__status {
        padding: 16px;
        font-size: 12px;
        color: #838389;
        text-align: center;
      }
      .cpk-td__status--error {
        color: #c0392b;
      }

      .cpk-td__event-payload {
        margin: 0;
        font-family: "Fira Code", "Cascadia Code", ui-monospace, monospace;
        font-size: 12px;
        line-height: 1.6;
        white-space: pre-wrap;
        word-break: break-all;
        color: #374151;
        padding: 10px 12px;
      }
    `,
  ],
})
export class ThreadDetailsComponent {
  private sanitizer = inject(DomSanitizer);
  private el = inject(ElementRef);

  threadId = input<string | null>(null);
  thread = input<InspectorThreadMeta | null>(null);
  runtimeUrl = input<string>("");
  headers = input<Record<string, string>>({});
  /** If provided, used directly instead of fetching from the API. Useful for Storybook. */
  conversationOverride = input<ConversationItem[] | null>(null);
  /** Which tab to show on mount (and after threadId changes). Defaults to "conversation". */
  initialTab = input<Tab>("conversation");

  readonly TAB_LIST: { id: Tab; label: string }[] = [
    { id: "conversation", label: "Conversation" },
    { id: "agent-state", label: "Agent State" },
    { id: "ag-ui-events", label: "AG-UI Events" },
  ];

  activeTab = signal<Tab>("conversation");
  selectedToolCallId = signal<string | null>(null);
  conversation = signal<ConversationItem[]>([]);
  isLoadingMessages = signal(false);
  messagesError = signal<string | null>(null);

  agentState = FAKE_AGENT_STATE;
  aguiEvents: FakeAguiEvent[] = FAKE_AGUI_EVENTS;

  private fetchAbortController: AbortController | null = null;

  constructor() {
    effect(() => {
      const threadId = this.threadId();
      this.activeTab.set(this.initialTab());
      this.selectedToolCallId.set(null);
      this.fetchAbortController?.abort();
      this.fetchAbortController = null;
      if (threadId) {
        void this.fetchMessages(threadId);
      } else {
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

  selectedToolCall = computed<ConversationToolCall | null>(() => {
    const id = this.selectedToolCallId();
    if (!id) return null;
    return (
      this.conversation().find(
        (item): item is ConversationToolCall =>
          item.type === "tool_call" && item.id === id,
      ) ?? null
    );
  });

  selectToolCall(id: string): void {
    this.selectedToolCallId.set(this.selectedToolCallId() === id ? null : id);
  }

  onClose(): void {
    this.el.nativeElement.dispatchEvent(
      new CustomEvent("cpkback", { bubbles: true, composed: true }),
    );
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

  // Cast helpers — Angular templates don't narrow union types inside *ngIf
  asToolCall(item: RenderItem): ConversationToolCall {
    return item as ConversationToolCall;
  }

  asToolCallGroup(item: RenderItem): ToolCallGroup {
    return item as ToolCallGroup;
  }

  asReasoning(item: RenderItem): ConversationReasoning {
    return item as ConversationReasoning;
  }

  // JSON syntax highlighter. Uses inline styles so Angular's ViewEncapsulation
  // doesn't strip the classes from innerHTML-injected nodes.
  // Safe to use bypassSecurityTrustHtml here — input is always structured data
  // from the store (never raw user-controlled HTML).
  highlightedJson(obj: unknown): SafeHtml {
    const colors: Record<string, string> = {
      key: "#C48338",
      str: "#3FA184",
      num: "#3FA184",
      bool: "#3FA184",
      nil: "#3FA184",
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
