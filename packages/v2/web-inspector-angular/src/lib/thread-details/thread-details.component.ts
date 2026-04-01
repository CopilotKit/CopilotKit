import {
  Component,
  ChangeDetectionStrategy,
  input,
  effect,
} from "@angular/core";
import { CommonModule } from "@angular/common";

// ---- Fake data types --------------------------------------------------------

export interface FakeMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  createdAt: string;
}

export interface FakeAgentStateEvent {
  type: string;
  timestamp: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
}

// ---- Fake data --------------------------------------------------------------

const FAKE_MESSAGES: FakeMessage[] = [
  {
    id: "msg-1",
    role: "user",
    content: "Can you help me plan a dog and pony show?",
    createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  },
  {
    id: "msg-2",
    role: "assistant",
    content:
      "Sure! I'll search for venue options and typical formats for dog and pony shows.",
    createdAt: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
  },
  {
    id: "msg-3",
    role: "tool",
    toolName: "search_venues",
    content: JSON.stringify({ results: ["Grand Ballroom", "Civic Center", "Expo Hall"] }),
    createdAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
  },
  {
    id: "msg-4",
    role: "assistant",
    content:
      "I found three venue options: Grand Ballroom, Civic Center, and Expo Hall. Which fits your budget?",
    createdAt: new Date(Date.now() - 7 * 60 * 1000).toISOString(),
  },
  {
    id: "msg-5",
    role: "user",
    content: "Let's go with the Grand Ballroom.",
    createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  },
];

const FAKE_AGENT_STATE = {
  thread_id: "c2f262b8-4b3e-4d9e-9d7c-8348c8cc0f67",
  agent: "planning-agent",
  status: "idle",
  state: {
    venue: "Grand Ballroom",
    confirmed: true,
    budget_range: "$5,000–$10,000",
    attendee_estimate: 120,
    tasks_remaining: ["book catering", "arrange transport", "send invites"],
  },
  last_updated: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
};

const FAKE_EVENTS: FakeAgentStateEvent[] = [
  {
    type: "RUN_STARTED",
    timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    payload: { run_id: "run-aaa", thread_id: "c2f262b8-4b3e-4d9e-9d7c-8348c8cc0f67" },
  },
  {
    type: "TEXT_MESSAGE_START",
    timestamp: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
    payload: { message_id: "msg-2", role: "assistant" },
  },
  {
    type: "TEXT_MESSAGE_CONTENT",
    timestamp: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
    payload: { message_id: "msg-2", delta: "Sure! I'll search for venue options..." },
  },
  {
    type: "TEXT_MESSAGE_END",
    timestamp: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
    payload: { message_id: "msg-2" },
  },
  {
    type: "TOOL_CALL_START",
    timestamp: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
    payload: { tool_call_id: "tc-1", tool_name: "search_venues" },
  },
  {
    type: "TOOL_CALL_RESULT",
    timestamp: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
    payload: { tool_call_id: "tc-1", result: ["Grand Ballroom", "Civic Center", "Expo Hall"] },
  },
  {
    type: "STATE_SNAPSHOT",
    timestamp: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    payload: { venue: "Grand Ballroom", confirmed: true },
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
  template: `
    <div class="cpk-td">
      <!-- Back button + title -->
      <div class="cpk-td__topbar">
        <button class="cpk-td__back" (click)="onBack()">← Back</button>
        <span class="cpk-td__title">{{ threadName }}</span>
      </div>

      <!-- Tab bar -->
      <div class="cpk-td__tabs" role="tablist">
        <button
          *ngFor="let tab of TAB_LIST"
          role="tab"
          [class.cpk-td__tab--active]="activeTab === tab.id"
          class="cpk-td__tab"
          (click)="activeTab = tab.id"
        >{{ tab.label }}</button>
      </div>

      <!-- Tab panels -->
      <div class="cpk-td__panel">

        <!-- Conversation -->
        <ng-container *ngIf="activeTab === 'conversation'">
          <div
            *ngFor="let msg of messages"
            class="cpk-td__msg"
            [ngClass]="'cpk-td__msg--' + msg.role"
          >
            <div class="cpk-td__msg-header">
              <span class="cpk-td__msg-role">{{ msg.role === 'tool' ? (msg.toolName ?? 'tool') : msg.role }}</span>
              <span class="cpk-td__msg-time">{{ msg.createdAt | date: 'shortTime' }}</span>
            </div>
            <pre class="cpk-td__msg-body">{{ msg.role === 'tool' ? formatJson(msg.content) : msg.content }}</pre>
          </div>
        </ng-container>

        <!-- Agent State -->
        <ng-container *ngIf="activeTab === 'agent-state'">
          <pre class="cpk-td__json">{{ agentStateJson }}</pre>
        </ng-container>

        <!-- AG-UI Events -->
        <ng-container *ngIf="activeTab === 'ag-ui-events'">
          <div *ngFor="let event of events" class="cpk-td__event">
            <div class="cpk-td__event-header">
              <span class="cpk-td__event-type">{{ event.type }}</span>
              <span class="cpk-td__event-time">{{ event.timestamp | date: 'shortTime' }}</span>
            </div>
            <pre class="cpk-td__event-payload">{{ event.payload | json }}</pre>
          </div>
        </ng-container>

      </div>
    </div>
  `,
  styles: [`
    .cpk-td {
      font-family: sans-serif;
      font-size: 13px;
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 400px;
    }

    /* Topbar */
    .cpk-td__topbar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border-bottom: 1px solid #e5e7eb;
      background: #f9fafb;
    }
    .cpk-td__back {
      background: none;
      border: none;
      cursor: pointer;
      color: #6366f1;
      font-size: 13px;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .cpk-td__back:hover { background: #eef2ff; }
    .cpk-td__title {
      font-weight: 600;
      color: #111827;
    }

    /* Tabs */
    .cpk-td__tabs {
      display: flex;
      border-bottom: 1px solid #e5e7eb;
      background: #fff;
    }
    .cpk-td__tab {
      padding: 8px 16px;
      border: none;
      background: none;
      cursor: pointer;
      font-size: 13px;
      color: #6b7280;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
    }
    .cpk-td__tab:hover { color: #111827; }
    .cpk-td__tab--active {
      color: #6366f1;
      border-bottom-color: #6366f1;
      font-weight: 600;
    }

    /* Panel */
    .cpk-td__panel {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
    }

    /* Conversation messages */
    .cpk-td__msg {
      margin-bottom: 12px;
      border-radius: 6px;
      padding: 8px 10px;
    }
    .cpk-td__msg--user    { background: #eff6ff; }
    .cpk-td__msg--assistant { background: #f0fdf4; }
    .cpk-td__msg--tool    { background: #fefce8; font-family: monospace; }

    .cpk-td__msg-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 4px;
    }
    .cpk-td__msg-role {
      font-weight: 600;
      text-transform: capitalize;
      font-size: 11px;
      color: #374151;
    }
    .cpk-td__msg-time { font-size: 11px; color: #9ca3af; }
    .cpk-td__msg-body {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 13px;
      font-family: inherit;
      color: #111827;
    }
    .cpk-td__msg--tool .cpk-td__msg-body { font-family: monospace; font-size: 12px; }

    /* Agent state JSON */
    .cpk-td__json {
      margin: 0;
      font-family: monospace;
      font-size: 12px;
      color: #111827;
      white-space: pre-wrap;
      word-break: break-word;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 12px;
    }

    /* AG-UI events */
    .cpk-td__event {
      margin-bottom: 8px;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      overflow: hidden;
    }
    .cpk-td__event-header {
      display: flex;
      justify-content: space-between;
      padding: 6px 10px;
      background: #f3f4f6;
    }
    .cpk-td__event-type {
      font-family: monospace;
      font-size: 12px;
      font-weight: 600;
      color: #6366f1;
    }
    .cpk-td__event-time { font-size: 11px; color: #9ca3af; }
    .cpk-td__event-payload {
      margin: 0;
      padding: 8px 10px;
      font-family: monospace;
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-word;
      color: #374151;
    }
  `],
})
export class ThreadDetailsComponent {
  // Signal input — Angular 17+ style. Storybook's TransformInputSignalType
  // picks these up automatically, so they appear as story args.
  threadId = input<string | null>(null);

  readonly TAB_LIST: { id: Tab; label: string }[] = [
    { id: "conversation",  label: "Conversation" },
    { id: "agent-state",   label: "Agent State" },
    { id: "ag-ui-events",  label: "AG-UI Events" },
  ];

  activeTab: Tab = "conversation";

  // Fake data — swapped for real store data once CPK-7191 lands
  messages: FakeMessage[] = FAKE_MESSAGES;
  agentStateJson = JSON.stringify(FAKE_AGENT_STATE, null, 2);
  events: FakeAgentStateEvent[] = FAKE_EVENTS;

  constructor() {
    // effect() is the signal-world replacement for ngOnChanges — it re-runs
    // whenever any signal it reads (threadId here) emits a new value.
    effect(() => {
      this.threadId(); // subscribe to threadId changes
      this.activeTab = "conversation";
    });
  }

  get threadName(): string {
    const id = this.threadId();
    return id ? `Thread ${id.slice(0, 8)}…` : "Thread Details";
  }

  onBack(): void {
    // Fires a native DOM event so the Custom Element host (or Storybook) can
    // listen with addEventListener('cpk:back', ...) without needing Angular.
    const el = document.querySelector("cpk-thread-details");
    el?.dispatchEvent(new CustomEvent("cpk:back", { bubbles: true, composed: true }));
  }

  formatJson(raw: string): string {
    try { return JSON.stringify(JSON.parse(raw), null, 2); }
    catch { return raw; }
  }
}
