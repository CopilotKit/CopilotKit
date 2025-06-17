// Mock for @segment/analytics-node to prevent Jest ES module issues
module.exports = {
  Analytics: jest.fn().mockImplementation(() => ({
    track: jest.fn(),
    identify: jest.fn(),
    alias: jest.fn(),
    group: jest.fn(),
    page: jest.fn(),
    screen: jest.fn(),
    flush: jest.fn(),
    shutdown: jest.fn(),
  })),
};
