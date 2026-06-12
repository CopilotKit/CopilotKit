module.exports = {
  presets: ["module:@react-native/babel-preset"],
  // zod v4 (pulled in by @copilotkit/react-core) uses `export * as ns from`,
  // which RN's Babel preset doesn't transform by default.
  plugins: ["@babel/plugin-transform-export-namespace-from"],
};
