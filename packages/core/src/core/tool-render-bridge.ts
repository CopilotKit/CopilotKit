import { ToolCallStatus } from "../types";

export interface ToolRenderRequest {
  toolCallId: string;
  toolName: string;
  agentId?: string;
  status: ToolCallStatus;
  args: unknown;
  result?: unknown;
}

export interface ToolRenderBridge {
  canRender(req: ToolRenderRequest): boolean;
  attach(req: ToolRenderRequest, hostEl: HTMLElement): void;
  detach(toolCallId: string): void;
}

export class ToolRenderRegistry {
  private bridges: Set<ToolRenderBridge> = new Set();
  private slotOwnership: Map<string, ToolRenderBridge> = new Map();

  addBridge(bridge: ToolRenderBridge): () => void {
    this.bridges.add(bridge);
    return () => {
      this.bridges.delete(bridge);
      for (const [id, owner] of this.slotOwnership) {
        if (owner === bridge) this.slotOwnership.delete(id);
      }
    };
  }

  canRender(req: ToolRenderRequest): boolean {
    for (const b of this.bridges) {
      if (b.canRender(req)) return true;
    }
    return false;
  }

  attach(req: ToolRenderRequest, hostEl: HTMLElement): boolean {
    const existing = this.slotOwnership.get(req.toolCallId);
    if (existing && this.bridges.has(existing)) {
      existing.attach(req, hostEl);
      return true;
    }
    for (const b of this.bridges) {
      if (b.canRender(req)) {
        b.attach(req, hostEl);
        this.slotOwnership.set(req.toolCallId, b);
        return true;
      }
    }
    return false;
  }

  detach(toolCallId: string): void {
    const owner = this.slotOwnership.get(toolCallId);
    this.slotOwnership.delete(toolCallId);
    if (owner) owner.detach(toolCallId);
  }
}
