// Mock implementation of chalk for testing
const chalk = {
  red: (text) => text,
  green: (text) => text,
  blue: (text) => text,
  yellow: (text) => text,
  cyan: (text) => text,
  magenta: (text) => text,
  gray: (text) => text,
  grey: (text) => text,
  bold: (text) => text,
  dim: (text) => text,
  italic: (text) => text,
  underline: (text) => text,
  strikethrough: (text) => text,
  inverse: (text) => text,
  hidden: (text) => text,
  visible: (text) => text,
  reset: (text) => text,
  // Chainable methods
  bgRed: (text) => text,
  bgGreen: (text) => text,
  bgBlue: (text) => text,
  bgYellow: (text) => text,
  bgCyan: (text) => text,
  bgMagenta: (text) => text,
  bgWhite: (text) => text,
  bgBlack: (text) => text,
};

// Make chalk chainable
Object.keys(chalk).forEach((key) => {
  chalk[key] = Object.assign(chalk[key], chalk);
});

module.exports = chalk;
module.exports.default = chalk;
