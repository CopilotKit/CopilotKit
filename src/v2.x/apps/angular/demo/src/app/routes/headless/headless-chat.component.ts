import { Component, ChangeDetectionStrategy, computed, inject, input, signal, OnDestroy, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import {
  connectAgentContext,
  CopilotKit,
  HumanInTheLoopToolCall,
  HumanInTheLoopToolRenderer,
  injectAgentStore,
  registerHumanInTheLoop,
} from "@copilotkitnext/angular";
import { RenderToolCalls } from "@copilotkitnext/angular";
import { WEB_INSPECTOR_TAG, type WebInspectorElement } from "@copilotkitnext/web-inspector";
import { z } from "zod";

@Component({
  selector: "require-approval",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div>Require approval</div>
    <button (click)="respond({ approved: true })">Approve</button>
    <button (click)="respond({ approved: false })">Deny</button>
  `,
})
export class RequireApprovalComponent implements HumanInTheLoopToolRenderer {
  toolCall = input.required<HumanInTheLoopToolCall<{ action: string; reason: string }>>();

  respond(result: { approved: boolean }) {
    this.toolCall().respond(result);
  }
}

@Component({
  selector: "headless-chat",
  standalone: true,
  imports: [CommonModule, FormsModule, RenderToolCalls],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="headless-container" style="display:flex;flex-direction:column;height:100vh;width:100vw;">
      <div class="messages" style="flex:1;overflow:auto;padding:16px;background:#f9fafb;color:#111827;">
        <div *ngFor="let m of messages()" style="margin-bottom:16px;">
          <div style="font-weight:600;color:#374151;">
            {{ m.role | titlecase }}
          </div>
          <div style="white-space:pre-wrap">{{ m.content }}</div>
          <ng-container *ngIf="m.role === 'assistant'">
            <copilot-render-tool-calls
              [message]="m"
              [messages]="messages() ?? []"
              [isLoading]="isRunning()"
            ></copilot-render-tool-calls>
          </ng-container>
        </div>
        <div *ngIf="isRunning()" style="opacity:0.9;color:#6b7280;">Thinking…</div>
      </div>

      <form
        (ngSubmit)="send()"
        style="display:flex;gap:8px;padding:12px;background:#ffffff;border-top:1px solid #e5e7eb;"
      >
        <input
          name="message"
          [(ngModel)]="inputValue"
          [disabled]="isRunning()"
          placeholder="Type a message…"
          style="flex:1;padding:10px 12px;border-radius:8px;border:1px solid #d1d5db;background:#ffffff;color:#111827;outline:none;"
        />
        <button
          type="submit"
          [disabled]="!inputValue.trim() || isRunning()"
          style="padding:10px 14px;border-radius:8px;border:1px solid #1d4ed8;background:#2563eb;color:#ffffff;cursor:pointer;"
        >
          Send
        </button>
      </form>
    </div>
  `,
})
export class HeadlessChatComponent implements OnInit, OnDestroy {
  readonly agentStore = injectAgentStore("openai");
  readonly agent = computed(() => this.agentStore()?.agent);
  readonly isRunning = computed(() => !!this.agentStore()?.isRunning());
  readonly messages = computed(() => this.agentStore()?.messages());
  readonly copilotkit = inject(CopilotKit);

  inputValue = "";
  private inspectorElement: WebInspectorElement | null = null;

  constructor() {
    registerHumanInTheLoop({
      name: "requireApproval",
      description: "Requires human approval before proceeding",
      parameters: z.object({
        action: z.string(),
        reason: z.string(),
      }),
      component: RequireApprovalComponent,
    });

    connectAgentContext(
      signal({
        value: "voice-mode",
        description: "active",
      }),
    );
  }

  ngOnInit(): void {
    if (typeof document === "undefined") return;

    const existing = document.querySelector<WebInspectorElement>(WEB_INSPECTOR_TAG);
    const inspector = existing ?? (document.createElement(WEB_INSPECTOR_TAG) as WebInspectorElement);
    inspector.core = this.copilotkit.core;
    inspector.setAttribute("auto-attach-core", "false");

    if (!existing) {
      document.body.appendChild(inspector);
    }

    this.inspectorElement = inspector;
  }

  ngOnDestroy(): void {
    if (this.inspectorElement && this.inspectorElement.isConnected) {
      this.inspectorElement.remove();
    }
    this.inspectorElement = null;
  }

  async send() {
    const content = this.inputValue.trim();
    const agent = this.agent();
    const isRunning = this.isRunning();

    if (!agent || !content || isRunning) return;

    agent.addMessage({ id: crypto.randomUUID(), role: "user", content });
    this.inputValue = "";

    try {
      await this.copilotkit.core.runAgent({ agent });
    } catch (e) {
      console.error("Agent run error", e);
    }
  }
}
