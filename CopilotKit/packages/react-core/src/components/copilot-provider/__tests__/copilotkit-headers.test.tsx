import React from "react";
import { render } from "@testing-library/react";
import { CopilotKit } from "../copilotkit";

jest.mock("../../../hooks/use-copilot-runtime-client", () => ({
  useCopilotRuntimeClient: jest.fn(() => ({
    generateCopilotResponse: jest.fn(),
  })),
}));

jest.mock("../../toast/toast-provider", () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => ({ setBannerError: jest.fn() }),
}));

describe("CopilotKit headers prop", () => {
  test("should accept static headers object", () => {
    expect(() => {
      render(
        <CopilotKit runtimeUrl="http://test.com" headers={{ Auth: "token" }}>
          <div>Test</div>
        </CopilotKit>,
      );
    }).not.toThrow();
  });

  test("should accept headers function", () => {
    const headersFn = () => ({ Auth: "dynamic-token" });
    expect(() => {
      render(
        <CopilotKit runtimeUrl="http://test.com" headers={headersFn}>
          <div>Test</div>
        </CopilotKit>,
      );
    }).not.toThrow();
  });

  test("should call headers function when resolving headers for requests", async () => {
    const headersFn = jest.fn(() => ({ Auth: "dynamic-token" }));
    render(
      <CopilotKit runtimeUrl="http://test.com" headers={headersFn}>
        <div>Test</div>
      </CopilotKit>,
    );
    expect(headersFn()).toEqual({ Auth: "dynamic-token" });
  });
});
