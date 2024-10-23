const JSDOMEnvironment = require('jest-environment-jsdom').default;
// Renaming these because of "cant redeclare block-scoped variable" error
const { TextEncoder: textEncoder, TextDecoder: textDecoder } = require('util');

global.TextEncoder = textEncoder;
global.TextDecoder = textDecoder;

class CustomEnvironment extends JSDOMEnvironment {
  async setup() {
    await super.setup();
    this.global.window = {
      location: {
        href: 'https://example.com'
      }
    };
  }
}

module.exports = CustomEnvironment;