const sharedConfig = require("tailwind-config/tailwind.config.js");

module.exports = {
  // prefix ui lib classes to avoid conflicting with the app
  // prefix: "ui-",
  mode: "jit",
  presets: [sharedConfig],
  purge: sharedConfig.content, // Use the 'content' from the shared config for purging
};
