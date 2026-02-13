module.exports = {
  Analytics: jest.fn().mockImplementation(() => ({
    track: jest.fn(),
    identify: jest.fn(),
    page: jest.fn(),
    group: jest.fn(),
    alias: jest.fn(),
  })),
};
