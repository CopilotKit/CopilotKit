import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "@ag-ui/client";
import { connectAgentContext } from "./agent-context";
import { CopilotKit } from "./copilotkit";

class CopilotKitCoreStub {
  addContext = vi.fn<(context: Context) => string>();
  removeContext = vi.fn<(id: string) => void>();

  constructor() {
    this.addContext.mockImplementation(() => `ctx-${this.addContext.mock.calls.length}`);
  }
}

class CopilotKitStub {
  core = new CopilotKitCoreStub();
}

describe("connectAgentContext", () => {
  let core: CopilotKitCoreStub;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: CopilotKit, useClass: CopilotKitStub }],
    });

    core = TestBed.inject(CopilotKit).core as unknown as CopilotKitCoreStub;
    core.addContext.mockClear();
    core.removeContext.mockClear();
  });

  it("registers context values and cleans up when the signal changes", async () => {
    @Component({
      standalone: true,
      template: "",
    })
    class HostComponent {
      context = signal<Context>({ description: "Initial", value: "1" });

      constructor() {
        connectAgentContext(this.context);
      }
    }

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(core.addContext).toHaveBeenNthCalledWith(1, { description: "Initial", value: "1" });

    fixture.componentInstance.context.set({ description: "Updated", value: "2" });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(core.removeContext).toHaveBeenNthCalledWith(1, "ctx-1");
    expect(core.addContext).toHaveBeenNthCalledWith(2, { description: "Updated", value: "2" });

    fixture.destroy();
    expect(core.removeContext).toHaveBeenNthCalledWith(2, "ctx-2");
  });

  it("throws when used outside of an injection context", () => {
    expect(() => connectAgentContext({ description: "missing", value: "0" })).toThrow(/inject\(\) must be called/);
  });
});
