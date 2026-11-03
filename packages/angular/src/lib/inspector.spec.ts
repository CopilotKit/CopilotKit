import packageInfo from "../../package.json";
import {
  Component,
  EnvironmentInjector,
  computed,
  PLATFORM_ID,
  inject,
  isDevMode,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureWebInspectorElement,
  WEB_INSPECTOR_TAG,
  defineWebInspector,
} from "@copilotkit/web-inspector";

import { provideCopilotKit, type CopilotKitConfig } from "./config";
import { CopilotKit } from "./copilotkit";
import {
  CopilotInspector,
  ɵCOPILOTKIT_INSPECTOR_DEVELOPMENT_MODE,
} from "./inspector";

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

  it("uses Angular isDevMode as the default development policy", () => {
    const provider = ɵCOPILOTKIT_INSPECTOR_DEVELOPMENT_MODE as unknown as {
      ɵprov: { factory: () => boolean };
    };

    expect(provider.ɵprov.factory).toBe(isDevMode);
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
    expect(configureWebInspectorElement).toHaveBeenLastCalledWith(
      expect.any(HTMLElement),
      fixture.componentInstance.copilotKit.core,
      {
        development: true,
        framework: "angular",
        sdkVersion: packageInfo.version,
      },
    );
  });

  it("never loads in production, even when explicitly enabled", async () => {
    await renderHost({ enableInspector: true }, "browser", false);
    expect(document.querySelector(WEB_INSPECTOR_TAG)).toBeNull();
    expect(defineWebInspector).not.toHaveBeenCalled();
  });

  it("does not load when explicitly disabled or rendering on the server", async () => {
    await renderHost({ enableInspector: false });
    expect(document.querySelector(WEB_INSPECTOR_TAG)).toBeNull();
    expect(defineWebInspector).not.toHaveBeenCalled();

    TestBed.resetTestingModule();
    await renderHost({ enableInspector: true }, "server");
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

  it("never loads on a remote development host, even when explicitly enabled", async () => {
    vi.stubGlobal("location", new URL("http://192.168.1.25:4200"));
    await renderHost({ enableInspector: true });
    expect(TestBed.inject(CopilotInspector).shouldRenderInspector).toBe(false);
    expect(defineWebInspector).not.toHaveBeenCalled();
  });

  it("enables Inspector message actions only while the Inspector is shown", async () => {
    await renderHost({});
    const service = TestBed.inject(CopilotInspector);
    const isEnabled = TestBed.runInInjectionContext(() =>
      computed(() => service.isInspectorEnabled),
    );
    const inspector = document.querySelector(WEB_INSPECTOR_TAG)!;
    expect(isEnabled()).toBe(false);

    inspector.dispatchEvent(
      new CustomEvent("cpk-inspector-visibility-change", {
        detail: { visible: true },
      }),
    );
    expect(isEnabled()).toBe(true);

    inspector.dispatchEvent(
      new CustomEvent("cpk-inspector-visibility-change", {
        detail: { visible: false },
      }),
    );
    expect(isEnabled()).toBe(false);
  });

  it("opens a request made before the Inspector loaded", async () => {
    TestBed.configureTestingModule({
      imports: [InspectorHost],
      providers: [
        provideCopilotKit({}),
        { provide: ɵCOPILOTKIT_INSPECTOR_DEVELOPMENT_MODE, useValue: true },
      ],
    });
    const request = { messageId: "message-early", threadId: "thread-1" };
    TestBed.inject(CopilotInspector).openInspector(request);
    const fixture = TestBed.createComponent(InspectorHost);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.dynamicImportSettled();

    const inspector = document.querySelector<
      HTMLElement & { openInspector: ReturnType<typeof vi.fn> }
    >(WEB_INSPECTOR_TAG);
    expect(inspector?.openInspector).toHaveBeenCalledExactlyOnceWith(
      "message_toolbar",
      request,
    );
  });

  it("removes an inspector it owns when the root service is destroyed", async () => {
    await renderHost({});
    expect(document.querySelector(WEB_INSPECTOR_TAG)).not.toBeNull();

    TestBed.inject(EnvironmentInjector).destroy();
    expect(document.querySelector(WEB_INSPECTOR_TAG)).toBeNull();
  });
});
