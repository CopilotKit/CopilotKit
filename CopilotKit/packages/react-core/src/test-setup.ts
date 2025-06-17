// Test setup for React Testing Library and jsdom
import "@testing-library/jest-dom";

// Mock console methods to avoid noise in tests
global.console = {
  ...console,
  // Keep error and warn for debugging
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
};
