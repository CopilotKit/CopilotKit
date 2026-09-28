import { Component, PLATFORM_ID, inject } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { expect, test, vi } from "vitest";
import {
  WEB_INSPECTOR_TAG,
  type WebInspectorElement,
} from "@copilotkit/web-inspector";
import { provideCopilotKit, type CopilotKitConfig } from "./config";
import { CopilotKit } from "./copilotkit";
import {
  CopilotInspector,
  ɵCOPILOTKIT_INSPECTOR_DEVELOPMENT_MODE,
} from "./inspector";

@Component({ standalone: true, template: "" })
class InspectorHost {
  readonly copilotKit = inject(CopilotKit);
}

/** Mount an isolated Angular provider and capture its Inspector before connection. */
function setup() {
  TestBed.resetTestingModule();
  document
    .querySelectorAll(WEB_INSPECTOR_TAG)
    .forEach((element) => element.remove());
  const connected: { intelligenceOnly: boolean; intelligenceAppUrl: string }[] =
    [];
  const appendChild = document.body.appendChild.bind(document.body);
  const appendSpy = vi
    .spyOn(document.body, "appendChild")
    .mockImplementation((node) => {
      if (node instanceof HTMLElement && node.matches(WEB_INSPECTOR_TAG)) {
        const element = node as WebInspectorElement;
        connected.push({
          intelligenceOnly: element.intelligenceOnly,
          intelligenceAppUrl: element.intelligenceAppUrl,
        });
      }
      return appendChild(node);
    });
  return {
    connected,
    async render(
      config: CopilotKitConfig,
      development = false,
      platform = "browser",
    ) {
      TestBed.configureTestingModule({
        imports: [InspectorHost],
        providers: [
          provideCopilotKit(config),
          { provide: PLATFORM_ID, useValue: platform },
          {
            provide: ɵCOPILOTKIT_INSPECTOR_DEVELOPMENT_MODE,
            useValue: development,
          },
        ],
      });
      const fixture = TestBed.createComponent(InspectorHost);
      fixture.detectChanges();
      await fixture.whenStable();
      await vi.dynamicImportSettled();
      return {
        fixture,
        service: TestBed.inject(CopilotInspector),
        element: document.querySelector<WebInspectorElement>(WEB_INSPECTOR_TAG),
      };
    },
    teardown() {
      TestBed.resetTestingModule();
      appendSpy.mockRestore();
      document
        .querySelectorAll(WEB_INSPECTOR_TAG)
        .forEach((element) => element.remove());
    },
  };
}

test("explicit production Inspector configuration mounts only the product mode without message shortcuts", async () => {
  const context = setup();
  try {
    const { element, service, fixture } = await context.render({
      intelligenceInspector: {
        appUrl: "https://intelligence.example/inspector.html",
      },
    });

    expect(element).not.toBeNull();
    expect(context.connected).toEqual([
      {
        intelligenceOnly: true,
        intelligenceAppUrl: "https://intelligence.example/inspector.html",
      },
    ]);
    expect(element?.core).toBe(fixture.componentInstance.copilotKit.core);
    expect(service.isInspectorEnabled).toBe(false);
    const openInspector = vi.fn();
    element!.openInspector = openInspector;
    service.openInspector({ messageId: "message-1" });
    expect(openInspector).not.toHaveBeenCalled();
  } finally {
    context.teardown();
  }
});

test("explicit disable takes precedence over production Inspector configuration", async () => {
  const context = setup();
  try {
    const { element, service } = await context.render({
      enableInspector: false,
      intelligenceInspector: {
        appUrl: "https://intelligence.example/inspector.html",
      },
    });

    expect(element).toBeNull();
    expect(service.isInspectorEnabled).toBe(false);
    expect(context.connected).toEqual([]);
  } finally {
    context.teardown();
  }
});

test("production Inspector configuration does not mount during server rendering", async () => {
  const context = setup();
  try {
    const { element, service } = await context.render(
      {
        intelligenceInspector: {
          appUrl: "https://intelligence.example/inspector.html",
        },
      },
      false,
      "server",
    );

    expect(element).toBeNull();
    expect(service.shouldRenderInspector).toBe(false);
    expect(context.connected).toEqual([]);
  } finally {
    context.teardown();
  }
});

test("local development retains the existing Inspector and message actions with Intelligence configured", async () => {
  const context = setup();
  try {
    const { element, service } = await context.render(
      {
        intelligenceInspector: {
          appUrl: "https://intelligence.example/inspector.html",
        },
      },
      true,
    );
    const openInspector = vi.fn();
    element!.openInspector = openInspector;

    service.openInspector({ messageId: "message-1", threadId: "thread-1" });

    expect(context.connected).toEqual([
      {
        intelligenceOnly: false,
        intelligenceAppUrl: "https://intelligence.example/inspector.html",
      },
    ]);
    expect(service.isInspectorEnabled).toBe(true);
    expect(openInspector).toHaveBeenCalledWith("message_toolbar", {
      messageId: "message-1",
      threadId: "thread-1",
    });
  } finally {
    context.teardown();
  }
});
