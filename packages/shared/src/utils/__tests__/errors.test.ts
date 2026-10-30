import { describe, expect, it } from "vitest";
import {
  CopilotKitError,
  CopilotKitErrorCode,
  ConfigurationError,
  ErrorVisibility,
  Severity,
} from "../errors";

describe("CopilotKitError", () => {
  it("is a plain Error that keeps the structured extensions", () => {
    const error = new CopilotKitError({
      message: "boom",
      code: CopilotKitErrorCode.NOT_FOUND,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("boom");
    expect(error.name).toBe("CopilotError");
    expect(error.extensions).toMatchObject({
      name: "CopilotError",
      code: CopilotKitErrorCode.NOT_FOUND,
      statusCode: 404,
      visibility: ErrorVisibility.BANNER,
      severity: Severity.CRITICAL,
      originalError: { message: "boom" },
    });
    expect(error.extensions.troubleshootingUrl).toContain(
      "network-errors-api-not-found",
    );
  });

  it("sets troubleshootingUrl to null when the code has none", () => {
    const error = new CopilotKitError({ code: CopilotKitErrorCode.UNKNOWN });
    expect(error.extensions.troubleshootingUrl).toBeNull();
  });

  it("keeps subclasses instanceof both the subclass and CopilotKitError", () => {
    const error = new ConfigurationError("bad config");
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(error).toBeInstanceOf(CopilotKitError);
    expect(error.extensions.code).toBe(CopilotKitErrorCode.CONFIGURATION_ERROR);
  });
});
