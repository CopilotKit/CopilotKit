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
import { shouldEnableInspector } from "./inspector";

@Component({
  standalone: true,
  template: "",
})
class InspectorHost {
  readonly copilotKit = inject(CopilotKit);
}

function stubHostname(hostname: string): () => void {
  const original = Object.getOwnPropertyDescriptor(window, "location");
  Object.defineProperty(window, "location", {
    value: { hostname },
    configurable: true,
  });
  return () => {
    if (original) Object.defineProperty(window, "location", original);
  };
}

async function renderHost(
  config: CopilotKitConfig,
  platformId: "browser" | "server" = "browser",
) {
  TestBed.configureTestingModule({
    imports: [InspectorHost],
    providers: [
      provideCopilotKit(config),
      { provide: PLATFORM_ID, useValue: platformId },
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

  it("uses explicit configuration before the local-host default", () => {
    expect(shouldEnableInspector(true, "app.example.com")).toBe(true);
    expect(shouldEnableInspector(false, "localhost")).toBe(false);
    expect(shouldEnableInspector(undefined, "localhost")).toBe(true);
    expect(shouldEnableInspector(undefined, "127.0.0.1")).toBe(true);
    expect(shouldEnableInspector(undefined, "0.0.0.0")).toBe(true);
    expect(shouldEnableInspector(undefined, "app.example.com")).toBe(false);
  });

  it("mounts by default on a local host and attaches the exact core", async () => {
    const restore = stubHostname("0.0.0.0");
    try {
      const fixture = await renderHost({});
      const inspector = document.querySelector<
        HTMLElement & { core?: unknown; autoAttachCore?: boolean }
      >(WEB_INSPECTOR_TAG);

      expect(inspector).not.toBeNull();
      expect(inspector?.core).toBe(fixture.componentInstance.copilotKit.core);
      expect(inspector?.autoAttachCore).toBe(false);
      expect(defineWebInspector).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("does not load on a remote host unless explicitly enabled", async () => {
    const restore = stubHostname("app.example.com");
    try {
      await renderHost({});
      expect(document.querySelector(WEB_INSPECTOR_TAG)).toBeNull();
      expect(defineWebInspector).not.toHaveBeenCalled();

      TestBed.resetTestingModule();
      await renderHost({ enableInspector: true });
      expect(document.querySelector(WEB_INSPECTOR_TAG)).not.toBeNull();
    } finally {
      restore();
    }
  });

  it("does not load when explicitly disabled or rendering on the server", async () => {
    const restore = stubHostname("localhost");
    try {
      await renderHost({ enableInspector: false });
      expect(document.querySelector(WEB_INSPECTOR_TAG)).toBeNull();
      expect(defineWebInspector).not.toHaveBeenCalled();

      TestBed.resetTestingModule();
      await renderHost({ enableInspector: true }, "server");
      expect(document.querySelector(WEB_INSPECTOR_TAG)).toBeNull();
      expect(defineWebInspector).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("reuses a pre-existing inspector without taking ownership", async () => {
    const restore = stubHostname("localhost");
    const existing = document.createElement(
      WEB_INSPECTOR_TAG,
    ) as HTMLElement & {
      core?: unknown;
    };
    document.body.appendChild(existing);

    try {
      const fixture = await renderHost({});
      expect(document.querySelectorAll(WEB_INSPECTOR_TAG)).toHaveLength(1);
      expect(existing.core).toBe(fixture.componentInstance.copilotKit.core);

      TestBed.resetTestingModule();
      expect(existing.isConnected).toBe(true);
    } finally {
      existing.remove();
      restore();
    }
  });

  it("removes an inspector it owns when the root service is destroyed", async () => {
    const restore = stubHostname("localhost");
    try {
      await renderHost({});
      expect(document.querySelector(WEB_INSPECTOR_TAG)).not.toBeNull();

      TestBed.inject(EnvironmentInjector).destroy();
      expect(document.querySelector(WEB_INSPECTOR_TAG)).toBeNull();
    } finally {
      restore();
    }
  });
});
