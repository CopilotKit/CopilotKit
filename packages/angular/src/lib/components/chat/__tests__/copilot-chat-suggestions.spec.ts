import { Injector, provideZonelessChangeDetection } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { AbstractAgent } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import type { SuggestionsConfig } from "@copilotkit/core";
import { Observable } from "rxjs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { provideCopilotKit } from "../../../config";
import { CopilotKit } from "../../../copilotkit";
import { CopilotChat } from "../copilot-chat";

class MockAgent extends AbstractAgent {
  constructor(id: string) {
    super({ agentId: id });
  }

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>();
  }
}

const welcomeSuggestions: SuggestionsConfig = {
  suggestions: [{ title: "Get started", message: "How do I start?" }],
  available: "always",
};

function renderChat(suggestionsConfig: SuggestionsConfig[] = []) {
  TestBed.configureTestingModule({
    teardown: { destroyAfterEach: true },
    imports: [CopilotChat],
    providers: [
      provideZonelessChangeDetection(),
      provideCopilotKit({
        licenseKey: "ck_pub_00000000000000000000000000000000",
        agents: { default: new MockAgent("default") },
        suggestionsConfig,
      }),
    ],
  });
  const copilotKit = TestBed.inject(CopilotKit);
  const fixture = TestBed.createComponent(CopilotChat);
  fixture.detectChanges();
  const titles = () =>
    fixture.componentInstance.suggestions().map(({ title }) => title);
  return { fixture, copilotKit, core: copilotKit.core, titles };
}

/** The agents `core.reloadSuggestions` was called for. */
function spyReloads(core: CopilotKit["core"]) {
  const reload = vi.spyOn(core, "reloadSuggestions");
  return () => reload.mock.calls.map(([agentId]) => agentId);
}

describe("CopilotChat suggestions", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  test("shows the provider's suggestionsConfig for the chat's agent", () => {
    const { titles } = renderChat([welcomeSuggestions]);

    expect(titles()).toEqual(["Get started"]);
  });

  test("a config bound while the chat is open loads once", async () => {
    const { fixture, copilotKit, core, titles } = renderChat();
    const reloads = spyReloads(core);

    copilotKit.configureSuggestions(welcomeSuggestions, {
      injector: TestBed.inject(Injector),
    });
    // Core announces the config change asynchronously.
    await fixture.whenStable();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(reloads()).toEqual(["default"]);
    expect(titles()).toEqual(["Get started"]);
  });

  test("another agent registering does not reload the chat's suggestions", async () => {
    const { core, titles } = renderChat([welcomeSuggestions]);
    const reloads = spyReloads(core);

    core.setAgents__unsafe_dev_only({
      default: core.getAgent("default")!,
      other: new MockAgent("other"),
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(reloads()).toEqual([]);
    expect(titles()).toEqual(["Get started"]);
  });
});
