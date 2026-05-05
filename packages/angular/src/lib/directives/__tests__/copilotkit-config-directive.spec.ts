import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKitConfigDirective } from "../copilotkit-config";
import { CopilotKit } from "../../copilotkit";

class CopilotKitStub {
  updateRuntime = vi.fn();
  agents = vi.fn(() => ({}));
}

describe("CopilotKitConfigDirective", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: CopilotKit, useClass: CopilotKitStub }],
    });
  });

  it("forwards a config object to CopilotKit.updateRuntime on init", () => {
    @Component({
      standalone: true,
      imports: [CopilotKitConfigDirective],
      template: `<div [copilotkitConfig]="config"></div>`,
    })
    class HostComponent {
      config = {
        runtimeUrl: "https://example.com",
        headers: { Authorization: "token" },
      };
    }

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const copilotkit = TestBed.inject(CopilotKit) as unknown as CopilotKitStub;
    expect(copilotkit.updateRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeUrl: "https://example.com",
        headers: { Authorization: "token" },
      }),
    );
  });

  it("forwards individual inputs to CopilotKit.updateRuntime", () => {
    @Component({
      standalone: true,
      imports: [CopilotKitConfigDirective],
      template: `
        <div copilotkitConfig
             [runtimeUrl]="runtimeUrl"
             [headers]="headers"
             [properties]="properties"></div>
      `,
    })
    class HostComponent {
      runtimeUrl = "https://api.example.com";
      headers = { "X-Custom": "yes" };
      properties = { tenant: "acme" };
    }

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const copilotkit = TestBed.inject(CopilotKit) as unknown as CopilotKitStub;
    expect(copilotkit.updateRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeUrl: "https://api.example.com",
        headers: { "X-Custom": "yes" },
        properties: { tenant: "acme" },
      }),
    );
  });

  it("re-applies config when inputs change", () => {
    @Component({
      standalone: true,
      imports: [CopilotKitConfigDirective],
      template: `<div copilotkitConfig [runtimeUrl]="runtimeUrl"></div>`,
    })
    class HostComponent {
      runtimeUrl = "https://first.example.com";
    }

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const copilotkit = TestBed.inject(CopilotKit) as unknown as CopilotKitStub;
    expect(copilotkit.updateRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({ runtimeUrl: "https://first.example.com" }),
    );

    fixture.componentInstance.runtimeUrl = "https://second.example.com";
    fixture.detectChanges();

    expect(copilotkit.updateRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({ runtimeUrl: "https://second.example.com" }),
    );
  });

  it("does not call updateRuntime when no inputs are set", () => {
    @Component({
      standalone: true,
      imports: [CopilotKitConfigDirective],
      template: `<div copilotkitConfig></div>`,
    })
    class HostComponent {}

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const copilotkit = TestBed.inject(CopilotKit) as unknown as CopilotKitStub;
    expect(copilotkit.updateRuntime).not.toHaveBeenCalled();
  });

  it("config object overrides individual inputs", () => {
    @Component({
      standalone: true,
      imports: [CopilotKitConfigDirective],
      template: `
        <div [copilotkitConfig]="config"
             [runtimeUrl]="ignored"
             [headers]="ignoredHeaders"></div>
      `,
    })
    class HostComponent {
      config = {
        runtimeUrl: "https://from-object.example.com",
        headers: { From: "object" },
      };
      ignored = "https://from-input.example.com";
      ignoredHeaders = { From: "input" };
    }

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const copilotkit = TestBed.inject(CopilotKit) as unknown as CopilotKitStub;
    expect(copilotkit.updateRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeUrl: "https://from-object.example.com",
        headers: { From: "object" },
      }),
    );
  });
});
