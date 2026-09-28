import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { CopilotA2UIRenderToolCall } from "../a2ui-render-tool-call";

describe("CopilotA2UIRenderToolCall", () => {
  it("renders nothing for a completed render_a2ui call, so only the activity paints the surface", () => {
    const fixture = TestBed.createComponent(CopilotA2UIRenderToolCall);
    fixture.componentRef.setInput("toolCall", {
      name: "render_a2ui",
      status: "complete",
      args: {
        surfaceId: "contact-form",
        data: { name: "" },
        components: [
          { id: "root", component: "Column", children: ["title", "name"] },
          { id: "title", component: "Text", text: "Contact us" },
          {
            id: "name",
            component: "TextField",
            label: "Name",
            value: { path: "/name" },
          },
        ],
      },
      result: '{"status":"rendered"}',
    });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).innerHTML).toBe("");
  });
});
