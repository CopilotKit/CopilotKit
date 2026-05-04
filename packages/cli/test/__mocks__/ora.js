// Mock implementation of ora for testing
const createSpinner = (options) => {
  const spinner = {
    text: typeof options === "string" ? options : options?.text || "",
    color: typeof options === "object" ? options?.color : "cyan",
    start: () => spinner,
    stop: () => spinner,
    succeed: (text) => {
      if (text) spinner.text = text;
      return spinner;
    },
    fail: (text) => {
      if (text) spinner.text = text;
      return spinner;
    },
    warn: (text) => {
      if (text) spinner.text = text;
      return spinner;
    },
    info: (text) => {
      if (text) spinner.text = text;
      return spinner;
    },
    clear: () => spinner,
    render: () => spinner,
  };
  return spinner;
};

module.exports = createSpinner;
module.exports.default = createSpinner;
