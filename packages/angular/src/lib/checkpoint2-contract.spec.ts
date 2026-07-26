import { describe, expect, it } from "vitest";

import { CopilotA2UIRecovery } from "./components/a2ui/a2ui-recovery";
import { CopilotPopup } from "./components/modal/copilot-popup";
import { CopilotSidebar } from "./components/modal/copilot-sidebar";
import { CopilotDefaultToolRenderer } from "./components/tools/default-tool-renderer";
import { InterruptController } from "./interrupt";
import { provideMCPApps } from "../mcp-apps/lib/provide-mcp-apps";

describe("Angular checkpoint 2 public behavior", () => {
  it("exposes the required UI and lifecycle adapters", () => {
    expect(CopilotPopup).toBeTypeOf("function");
    expect(CopilotSidebar).toBeTypeOf("function");
    expect(CopilotDefaultToolRenderer).toBeTypeOf("function");
    expect(CopilotA2UIRecovery).toBeTypeOf("function");
    expect(InterruptController).toBeTypeOf("function");
    expect(provideMCPApps).toBeTypeOf("function");
  });
});
