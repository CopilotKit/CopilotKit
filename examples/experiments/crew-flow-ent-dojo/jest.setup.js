// Setup fetch mock
require("jest-fetch-mock").enableMocks();

// Mock the console to silence unwanted messages during tests
global.console = {
  ...console,
  // Uncomment to disable specific console methods during tests
  // log: jest.fn(),
  // error: jest.fn(),
  // warn: jest.fn(),
};

// Mock timers
jest.useFakeTimers();
