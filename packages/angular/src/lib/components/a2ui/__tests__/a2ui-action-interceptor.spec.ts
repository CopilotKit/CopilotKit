import {
  Component,
  input,
  provideZonelessChangeDetection,
} from "@angular/core";
import type { Type } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { ActionSchema } from "@a2ui/web_core/v0_9";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAngularCatalog } from "../../../../a2ui/lib/create-catalog";
import type { A2UIProps } from "../../../../a2ui/lib/types";
import { CopilotKit } from "../../../copilotkit";
import { COPILOT_KIT_CONFIG } from "../../../config";
import { CopilotA2UIActivityRenderer } from "../a2ui-activity-renderer";
import { CopilotA2UIToolRenderer } from "../a2ui-tool-renderer";

const definitions = {
  Button: { props: z.object({ label: z.string(), action: ActionSchema }) },
};

@Component({
  selector: "test-intercepted-button",
  template: `
    <button type="button" (click)="props().action()">{{ props().label }}</button>
  `,
})
class ActionButton {
  readonly props = input.required<A2UIProps<typeof definitions, "Button">>();
}

describe.each(["activity", "tool"] as const)(
  "A2UI %s action interception",
  (kind) => {
    afterEach(() => TestBed.resetTestingModule());

    it("handles a rendered button locally through the provider's onAction", async () => {
      const onAction = vi.fn(() => null);
      const core = {
        properties: {},
        setProperties: vi.fn(),
        runAgent: vi.fn().mockResolvedValue(undefined),
      };
      const renderer: Type<unknown> =
        kind === "activity"
          ? CopilotA2UIActivityRenderer
          : CopilotA2UIToolRenderer;
      TestBed.configureTestingModule({
        imports: [renderer],
        providers: [
          provideZonelessChangeDetection(),
          { provide: CopilotKit, useValue: { core } },
          {
            provide: COPILOT_KIT_CONFIG,
            useValue: {
              a2ui: {
                catalog: createAngularCatalog(definitions, {
                  Button: ActionButton,
                }),
                onAction,
              },
            },
          },
        ],
      });
      const operations = [
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "products",
            components: [
              {
                id: "root",
                component: "Button",
                label: "Select product",
                action: {
                  event: {
                    name: "select_product",
                    context: { productId: "product-42" },
                  },
                },
              },
            ],
          },
        },
      ];
      const fixture = TestBed.createComponent(renderer);
      fixture.componentRef.setInput("agent", { agentId: "demo" });
      if (kind === "activity") {
        const message = {
          id: "activity-1",
          role: "activity",
          activityType: "a2ui-surface",
          content: { a2ui_operations: operations },
        };
        fixture.componentRef.setInput("activityType", message.activityType);
        fixture.componentRef.setInput("content", message.content);
        fixture.componentRef.setInput("message", message);
      } else {
        fixture.componentRef.setInput("toolCall", {
          status: "complete",
          args: { surfaceId: "products" },
          result: JSON.stringify({ a2ui_operations: operations }),
        });
      }
      await fixture.whenStable();

      const button = (fixture.nativeElement as HTMLElement).querySelector(
        "button",
      );
      expect(button?.textContent).toContain("Select product");
      button!.click();
      await fixture.whenStable();

      expect(onAction).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          name: "select_product",
          surfaceId: "products",
          sourceComponentId: "root",
          context: { productId: "product-42" },
        }),
        expect.any(Function),
      );
      expect(core.runAgent).not.toHaveBeenCalled();
      expect(core.setProperties).not.toHaveBeenCalled();
    });
  },
);
