/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/src/test-setup.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/dist/", "\\.d\\.ts$"],
  moduleNameMapper: {
    // Mock telemetry modules that cause ES module issues
    "@segment/analytics-node": "<rootDir>/src/__mocks__/analytics-node.js",
  },
  transformIgnorePatterns: ["node_modules/(?!(@segment/analytics-node|jose)/)"],
};
