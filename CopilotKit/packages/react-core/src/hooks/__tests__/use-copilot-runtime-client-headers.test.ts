import { renderHook } from "@testing-library/react";
import { useCopilotRuntimeClient } from "../use-copilot-runtime-client";

const mockClientInstance = {
  generateCopilotResponse: jest.fn(),
  _options: null as any,
};

jest.mock("@copilotkit/runtime-client-gql", () => ({
  CopilotRuntimeClient: jest.fn().mockImplementation((options) => {
    mockClientInstance._options = options;
    return mockClientInstance;
  }),
  GraphQLError: jest.fn(),
}));

jest.mock("../../components/toast/toast-provider", () => ({
  useToast: () => ({
    setBannerError: jest.fn(),
  }),
}));

describe("useCopilotRuntimeClient with dynamic headers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("should pass static headers to CopilotRuntimeClient", () => {
    const { CopilotRuntimeClient } = require("@copilotkit/runtime-client-gql");

    renderHook(() =>
      useCopilotRuntimeClient({
        url: "http://test.com",
        headers: { Authorization: "Bearer static" },
        onError: jest.fn(),
      }),
    );

    expect(CopilotRuntimeClient).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { Authorization: "Bearer static" },
      }),
    );
  });

  test("should pass headers function to CopilotRuntimeClient", () => {
    const { CopilotRuntimeClient } = require("@copilotkit/runtime-client-gql");
    const headersFn = () => ({ Authorization: "Bearer dynamic" });

    renderHook(() =>
      useCopilotRuntimeClient({
        url: "http://test.com",
        headers: headersFn,
        onError: jest.fn(),
      }),
    );

    expect(CopilotRuntimeClient).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: headersFn,
      }),
    );
  });
});
