import {
  CopilotKitCore,
  ToolCallStatus,
  type ToolRenderRequest,
} from "@copilotkit/core";

export const TOOL_RENDER_SLOT_TAG = "cpk-tool-render-slot" as const;

export type ToolRenderSlotData = {
  toolCallId: string;
  toolName: string;
  agentId?: string;
  status?: ToolCallStatus;
  args?: unknown;
  result?: unknown;
};

export class CpkToolRenderSlot extends HTMLElement {
  private _core: CopilotKitCore | null = null;
  private _data: ToolRenderSlotData | null = null;
  private _attached = false;
  private _fallbackEl: HTMLElement | null = null;

  set core(value: CopilotKitCore | null) {
    if (this._core === value) return;
    this.teardown();
    this._core = value;
    this.tryAttach();
  }

  set toolCall(value: ToolRenderSlotData | null) {
    const prev = this._data;
    this._data = value;
    if (prev && value && prev.toolCallId !== value.toolCallId) this.teardown();
    this.tryAttach();
  }

  connectedCallback(): void {
    this.tryAttach();
  }

  disconnectedCallback(): void {
    this.teardown();
  }

  private tryAttach(): void {
    if (!this.isConnected || !this._core || !this._data) return;
    const req: ToolRenderRequest = {
      toolCallId: this._data.toolCallId,
      toolName: this._data.toolName,
      agentId: this._data.agentId,
      status: this._data.status ?? ToolCallStatus.Complete,
      args: this._data.args,
      result: this._data.result,
    };
    this.clearFallback();
    const ok = this._core.attachToolRender(req, this);
    this._attached = ok;
    if (!ok) this.renderFallback(req);
  }

  private teardown(): void {
    if (this._attached && this._core && this._data) {
      this._core.detachToolRender(this._data.toolCallId);
    }
    this._attached = false;
    this.clearFallback();
  }

  private renderFallback(req: ToolRenderRequest): void {
    const argsText = formatJson(req.args);
    const el = document.createElement("pre");
    el.className =
      "cpk-tool-render-slot-fallback overflow-auto rounded bg-white p-2 text-[11px] leading-relaxed text-gray-800";
    el.textContent = argsText;
    this.appendChild(el);
    this._fallbackEl = el;
  }

  private clearFallback(): void {
    if (this._fallbackEl && this._fallbackEl.parentNode === this) {
      this.removeChild(this._fallbackEl);
    }
    this._fallbackEl = null;
  }
}

function formatJson(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

if (typeof customElements !== "undefined") {
  if (!customElements.get(TOOL_RENDER_SLOT_TAG)) {
    customElements.define(TOOL_RENDER_SLOT_TAG, CpkToolRenderSlot);
  }
}
