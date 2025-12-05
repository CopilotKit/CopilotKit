/// <reference types="jest" />
import { CopilotErrorEvent, CopilotErrorHandler } from "@copilotkit/shared";

describe("CopilotKit onError types", () => {
  let mockError: jest.Mock;

  beforeEach(() => {
    mockError = jest.fn();
  });

  describe("onError type checking", () => {
    it("should accept CopilotErrorHandler type", () => {
      // RED: Will fail - testing type compatibility
      const handler: CopilotErrorHandler = mockError;
      expect(handler).toBeDefined();
    });

    it("should validate error event structure", () => {
      // RED: Will fail - validating event structure
      const mockEvent: CopilotErrorEvent = {
        type: "error",
        timestamp: Date.now(),
        context: {
          source: "ui",
          request: {
            operation: "test",
            startTime: Date.now(),
          },
        },
      };

      expect(mockEvent.type).toBe("error");
      expect(mockEvent.timestamp).toBeDefined();
      expect(mockEvent.context.source).toBe("ui");
    });

    it("should validate error event types", () => {
      // RED: Will fail - ensuring all event types are valid
      const validTypes: CopilotErrorEvent["type"][] = [
        "error",
        "request",
        "response",
        "agent_state",
        "action",
        "message",
        "performance",
      ];

      expect(validTypes).toContain("error");
      expect(validTypes).toContain("request");
      expect(validTypes).toContain("agent_state");
    });
  });

  describe("error handler functionality", () => {
    it("should accept error handler with proper signature", () => {
      // RED: Will fail - testing handler function signature
      const handler: CopilotErrorHandler = (errorEvent: CopilotErrorEvent) => {
        console.log("Error:", errorEvent.type);
      };

      expect(typeof handler).toBe("function");
    });

    it("should handle async error handlers", async () => {
      // RED: Will fail - testing async handler support
      const asyncHandler: CopilotErrorHandler = async (errorEvent: CopilotErrorEvent) => {
        await Promise.resolve();
        return;
      };

      expect(typeof asyncHandler).toBe("function");
    });
  });
});
