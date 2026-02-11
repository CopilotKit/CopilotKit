import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { provideCopilotKit, injectCopilotKitConfig } from "../../config";

describe("CopilotKit config", () => {
  it("provides configuration via DI", () => {
    @Component({ standalone: true, template: "" })
    class HostComponent {
      config = injectCopilotKitConfig();
    }

    const headers = { Authorization: "token" };

    TestBed.configureTestingModule({
      providers: [
        provideCopilotKit({
          runtimeUrl: "https://example.com",
          headers,
        }),
      ],
    });

    const fixture = TestBed.createComponent(HostComponent);
    expect(fixture.componentInstance.config.runtimeUrl).toBe(
      "https://example.com"
    );
    expect(fixture.componentInstance.config.headers).toBe(headers);
  });
});
