// Mock modules that cause ES module issues
jest.mock("@segment/analytics-node", () => ({
  Analytics: jest.fn().mockImplementation(() => ({
    track: jest.fn(),
    identify: jest.fn(),
    page: jest.fn(),
    group: jest.fn(),
    alias: jest.fn(),
  })),
}));

jest.mock("@copilotkit/shared", () => ({
  parseJson: jest.fn((jsonString, defaultValue) => {
    try {
      return JSON.parse(jsonString);
    } catch {
      return defaultValue;
    }
  }),
  CopilotKitAgentDiscoveryError: jest.fn(),
}));

// Mock react-dom/test-utils to avoid compatibility issues
jest.mock("react-dom/test-utils", () => ({
  act: jest.fn((fn) => fn()),
}));
