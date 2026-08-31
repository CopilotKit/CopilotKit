import { useLayoutEffect } from "react";
// Mirrors packages/core/src/core/run-handler.ts tool-registry semantics.
export class CoreMock {
  _hookTools = new Map(); _subs = new Set();
  get tools() { return [...this._hookTools.values()]; }
  key(n, a) { return `${a ?? "global"}::${n}`; }
  addTool(t) { this._hookTools.set(this.key(t.name, t.agentId), t); this._emit(); }
  removeTool(n, a) { this._hookTools.delete(this.key(n, a)); this._emit(); }
  getTool({ toolName, agentId }) { return this._hookTools.get(this.key(toolName, agentId)); }
  getAgent() { return { agentId: "default" }; }
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
  _emit() { for (const s of this._subs) s(); }
}
// Copy of packages/react-core/src/v2/hooks/use-frontend-tool.tsx (registration half)
export function useFrontendTool(core, tool, deps = []) {
  useLayoutEffect(() => {
    if (core.getTool({ toolName: tool.name, agentId: tool.agentId })) core.removeTool(tool.name, tool.agentId);
    core.addTool(tool);
    return () => core.removeTool(tool.name, tool.agentId);
  }, [tool.name, tool.available, core, JSON.stringify(deps)]);
}
