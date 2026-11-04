import { TestBed } from "@angular/core/testing";
import type { ComponentFixture } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotChatUserMessage } from "../copilot-chat-user-message";
import { CopilotChatUserMessageBranchNavigation } from "../copilot-chat-user-message-branch-navigation";
import type { UserMessage } from "../copilot-chat-user-message.types";

const sampleMessage: UserMessage = {
  id: "msg-1",
  role: "user",
  content: "Hello from user",
};

const branchNavigationIn = (fixture: ComponentFixture<unknown>) =>
  fixture.nativeElement.querySelector(
    '[data-testid="copilot-branch-navigation"]',
  );

describe("CopilotChatUserMessage", () => {
  let fixture: ComponentFixture<CopilotChatUserMessage>;

  /** Renders the message with branch inputs and returns the fixture. */
  function render(inputs: {
    message?: UserMessage;
    numberOfBranches?: number;
    branchSwitchEnabled?: boolean;
  }) {
    fixture.componentRef.setInput("message", inputs.message ?? sampleMessage);
    if (inputs.numberOfBranches !== undefined)
      fixture.componentRef.setInput(
        "numberOfBranches",
        inputs.numberOfBranches,
      );
    if (inputs.branchSwitchEnabled !== undefined)
      fixture.componentRef.setInput(
        "branchSwitchEnabled",
        inputs.branchSwitchEnabled,
      );
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [CopilotChatUserMessage],
    }).compileComponents();
    fixture = TestBed.createComponent(CopilotChatUserMessage);
  });

  it("emits edit events when handleEdit is invoked", () => {
    render({});
    const editSpy = vi.fn();
    fixture.componentInstance.editMessage.subscribe(editSpy);

    fixture.componentInstance.handleEdit();
    expect(editSpy).toHaveBeenCalledWith({ message: sampleMessage });
  });

  it("exposes stable cross-frontend message classes", () => {
    const { computedClass } = render({}).componentInstance;
    expect(computedClass()).toContain("copilotKitMessage");
    expect(computedClass()).toContain("copilotKitUserMessage");
  });

  describe("branch navigation", () => {
    it("shows with more than one branch by default", () => {
      expect(
        branchNavigationIn(render({ numberOfBranches: 3 })),
      ).not.toBeNull();
    });

    it("hides with one branch", () => {
      expect(branchNavigationIn(render({ numberOfBranches: 1 }))).toBeNull();
    });

    it("shows when branch switching is enabled", () => {
      expect(
        branchNavigationIn(
          render({ numberOfBranches: 3, branchSwitchEnabled: true }),
        ),
      ).not.toBeNull();
    });

    it("hides when branch switching is disabled", () => {
      expect(
        branchNavigationIn(
          render({ numberOfBranches: 3, branchSwitchEnabled: false }),
        ),
      ).toBeNull();
    });
  });

  it("forwards branch navigation events", () => {
    render({});
    const switchSpy = vi.fn();
    fixture.componentInstance.switchToBranch.subscribe(switchSpy);

    const payload = {
      branchIndex: 2,
      numberOfBranches: 3,
      message: sampleMessage,
    };
    fixture.componentInstance.handleSwitchToBranch(payload);
    expect(switchSpy).toHaveBeenCalledWith(payload);
  });

  it("splits multimodal user content into text and attachment previews", () => {
    const { componentInstance } = render({
      message: {
        id: "msg-2",
        role: "user",
        content: [
          { type: "text", text: "Please inspect this" },
          {
            type: "image",
            source: {
              type: "data",
              value: "data:image/png;base64,AAAA",
              mimeType: "image/png",
            },
            metadata: { filename: "chart.png" },
          },
          {
            type: "document",
            source: {
              type: "data",
              value: "data:application/pdf;base64,AAAA",
              mimeType: "application/pdf",
            },
            metadata: { filename: "report.pdf" },
          },
        ],
      },
    });

    const media = componentInstance.mediaParts();
    expect(componentInstance.flattenedContent()).toBe("Please inspect this");
    expect(media).toHaveLength(2);
    expect(componentInstance.filenameFor(media[0]!)).toBe("chart.png");
    expect(componentInstance.filenameFor(media[1]!)).toBe("report.pdf");
  });
});

describe("CopilotChatUserMessageBranchNavigation", () => {
  async function renderNavigation(branchSwitchEnabled?: boolean) {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [CopilotChatUserMessageBranchNavigation],
    }).compileComponents();
    const fixture = TestBed.createComponent(
      CopilotChatUserMessageBranchNavigation,
    );
    fixture.componentRef.setInput("message", sampleMessage);
    fixture.componentRef.setInput("numberOfBranches", 2);
    if (branchSwitchEnabled !== undefined)
      fixture.componentRef.setInput("branchSwitchEnabled", branchSwitchEnabled);
    fixture.detectChanges();
    return fixture;
  }

  it("shows by default with more than one branch", async () => {
    expect(branchNavigationIn(await renderNavigation())).not.toBeNull();
  });

  it("hides when branch switching is disabled", async () => {
    expect(branchNavigationIn(await renderNavigation(false))).toBeNull();
  });
});
