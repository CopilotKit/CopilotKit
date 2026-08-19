import {
  Component,
  EnvironmentInjector,
  PLATFORM_ID,
  inject,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WEB_INSPECTOR_TAG,
  defineWebInspector,
} from "@copilotkit/web-inspector";

import { provideCopilotKit, type CopilotKitConfig } from "./config";
import { CopilotKit } from "./copilotkit";
import { ɵCOPILOTKIT_INSPECTOR_DEVELOPMENT_MODE } from "./inspector";

@Component({
  standalone: true,
  template: "",
})
class InspectorHost {
  readonly copilotKit = inject(CopilotKit);
}

async function renderHost(
  config: CopilotKitConfig,
  platformId: "browser" | "server" = "browser",
  isDevelopment = true,
) {
  TestBed.configureTestingModule({
    imports: [InspectorHost],
    providers: [
      provideCopilotKit(config),
      { provide: PLATFORM_ID, useValue: platformId },
      {
        provide: ɵCOPILOTKIT_INSPECTOR_DEVELOPMENT_MODE,
        useValue: isDevelopment,
      },
    ],
  });
  const fixture = TestBed.createComponent(InspectorHost);
  fixture.detectChanges();
  await fixture.whenStable();
  await vi.dynamicImportSettled();
  fixture.detectChanges();
  return fixture;
}

describe("Angular inspector integration", () => {
  async function settleInspectorLoad(): Promise<void> {
    await vi.dynamicImportSettled();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    document.querySelectorAll(WEB_INSPECTOR_TAG).forEach((element) => {
      element.remove();
    });
    vi.mocked(defineWebInspector).mockClear();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
    document.querySelectorAll(WEB_INSPECTOR_TAG).forEach((element) => {
      element.remove();
    });
  });

  it("mounts by default in development and attaches the exact core before connection", async () => {
    const appendChild = document.body.appendChild.bind(document.body);
    let coreAtAppend: unknown;
    let autoAttachCoreAtAppend: boolean | undefined;
    vi.spyOn(document.body, "appendChild").mockImplementation((node) => {
      if (node instanceof Element && node.matches(WEB_INSPECTOR_TAG)) {
        const inspector = node as Element & {
          autoAttachCore?: boolean;
          core?: unknown;
        };
        coreAtAppend = inspector.core;
        autoAttachCoreAtAppend = inspector.autoAttachCore;
      }
      return appendChild(node);
    });

    const fixture = await renderHost({});
    const inspector = document.querySelector<
      HTMLElement & {
        autoAttachCore?: boolean;
        core?: unknown;
      }
    >(WEB_INSPECTOR_TAG);

    expect(inspector).not.toBeNull();
    expect(inspector?.core).toBe(fixture.componentInstance.copilotKit.core);
    expect(inspector?.autoAttachCore).toBe(false);
    expect(coreAtAppend).toBe(fixture.componentInstance.copilotKit.core);
    expect(autoAttachCoreAtAppend).toBe(false);
    expect(defineWebInspector).toHaveBeenCalledTimes(1);
  });

  it("never loads in production, even when explicitly enabled", async () => {
    await renderHost({ enableInspector: true }, "browser", false);
    await settleInspectorLoad();
    expect(document.querySelector(WEB_INSPECTOR_TAG)).toBeNull();
    expect(defineWebInspector).not.toHaveBeenCalled();
  });

  it("does not load when explicitly disabled or rendering on the server", async () => {
    await renderHost({ enableInspector: false });
    await settleInspectorLoad();
    expect(document.querySelector(WEB_INSPECTOR_TAG)).toBeNull();
    expect(defineWebInspector).not.toHaveBeenCalled();

    TestBed.resetTestingModule();
    await renderHost({ enableInspector: true }, "server");
    await settleInspectorLoad();
    expect(document.querySelector(WEB_INSPECTOR_TAG)).toBeNull();
    expect(defineWebInspector).not.toHaveBeenCalled();
  });

  it("reuses a pre-existing inspector without taking ownership", async () => {
    const existing = document.createElement(
      WEB_INSPECTOR_TAG,
    ) as HTMLElement & {
      core?: unknown;
    };
    document.body.appendChild(existing);

    const fixture = await renderHost({});
    expect(document.querySelectorAll(WEB_INSPECTOR_TAG)).toHaveLength(1);
    expect(existing.core).toBe(fixture.componentInstance.copilotKit.core);

    TestBed.resetTestingModule();
    expect(existing.isConnected).toBe(true);
    existing.remove();
  });

  it("removes an inspector it owns when the root service is destroyed", async () => {
    await renderHost({});
    expect(document.querySelector(WEB_INSPECTOR_TAG)).not.toBeNull();

    TestBed.inject(EnvironmentInjector).destroy();
    expect(document.querySelector(WEB_INSPECTOR_TAG)).toBeNull();
  });
});
