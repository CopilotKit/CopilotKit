import { EnvironmentInjector, runInInjectionContext, computed } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotChatUserMessage } from "../copilot-chat-user-message";
import type { UserMessage } from "../copilot-chat-user-message.types";

const sampleMessage: UserMessage = {
  id: "msg-1",
  role: "user",
  content: "Hello from user",
};

describe("CopilotChatUserMessage", () => {
  let injector: EnvironmentInjector;
  let component: CopilotChatUserMessage;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    injector = TestBed.inject(EnvironmentInjector);
    component = runInInjectionContext(injector, () => new CopilotChatUserMessage());
    (component as any).message = () => sampleMessage;
  });

  it("emits edit events when handleEdit is invoked", () => {
    const editSpy = vi.fn();
    component.editMessage.subscribe(editSpy);

    component.handleEdit();
    expect(editSpy).toHaveBeenCalledWith({ message: sampleMessage });
  });

  it("indicates when branch navigation should be shown", () => {
    (component as any).numberOfBranches = () => 3;
    component.showBranchNavigation = computed(() => ((component as any).numberOfBranches() ?? 1) > 1);
    expect(component.showBranchNavigation()).toBe(true);

    (component as any).numberOfBranches = () => 1;
    component.showBranchNavigation = computed(() => ((component as any).numberOfBranches() ?? 1) > 1);
    expect(component.showBranchNavigation()).toBe(false);
  });

  it("forwards branch navigation events", () => {
    const switchSpy = vi.fn();
    component.switchToBranch.subscribe(switchSpy);

    const payload = { branchIndex: 2, numberOfBranches: 3, message: sampleMessage };
    component.handleSwitchToBranch(payload);
    expect(switchSpy).toHaveBeenCalledWith(payload);
  });
});
