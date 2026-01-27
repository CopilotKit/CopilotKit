import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import {
  COPILOT_CHAT_DEFAULT_LABELS,
  injectChatLabels,
  provideCopilotChatLabels,
} from "../../chat-config";

describe("Copilot chat labels", () => {
  it("returns default labels when no provider is registered", () => {
    @Component({ standalone: true, template: "" })
    class HostComponent {
      labels = injectChatLabels();
    }

    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(HostComponent);

    expect(fixture.componentInstance.labels).toEqual(COPILOT_CHAT_DEFAULT_LABELS);
  });

  it("merges provided labels with defaults", () => {
    @Component({ standalone: true, template: "" })
    class HostComponent {
      labels = injectChatLabels();
    }

    TestBed.configureTestingModule({
      providers: [
        provideCopilotChatLabels({
          chatInputPlaceholder: "Override",
        }),
      ],
    });

    const fixture = TestBed.createComponent(HostComponent);
    expect(fixture.componentInstance.labels.chatInputPlaceholder).toBe(
      "Override"
    );
    expect(fixture.componentInstance.labels.assistantMessageToolbarCopyCodeLabel)
      .toBe(COPILOT_CHAT_DEFAULT_LABELS.assistantMessageToolbarCopyCodeLabel);
  });
});
