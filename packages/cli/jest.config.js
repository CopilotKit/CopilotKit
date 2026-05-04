export default {
  preset: "ts-jest/presets/default-esm",
  extensionsToTreatAsEsm: [".ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true }],
  },
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^chalk$": "<rootDir>/test/__mocks__/chalk.js",
    "^ora$": "<rootDir>/test/__mocks__/ora.js",
  },
  testMatch: ["**/test/**/*.test.ts"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts"],
  testEnvironment: "node",
  testPathIgnorePatterns: [
    "test/commands/dev.test.ts",
    "test/commands/tunnel.test.ts",
  ],
};
