/**
 * Suggestion prompts surfaced in the chat composer. Each suggestion
 * explicitly asks the agent to produce an interactive sandboxed UI that
 * calls one of the host-side sandbox functions (see `sandbox-functions.ts`),
 * so the demo visibly exercises the iframe <-> host bridge end-to-end.
 */
export const openGenUiSuggestions = [
  {
    title: "Calculator (calls evaluateExpression)",
    message:
      "Build a modern calculator UI. When the user presses '=', the button handler MUST call " +
      "`await Websandbox.connection.remote.evaluateExpression({ expression })` with the current " +
      "display expression, then update the display to the returned numeric value. Show the " +
      "history of computed values below the display.",
  },
  {
    title: "Ping the host (calls notifyHost)",
    message:
      "Build a simple card with a 'Say hi to the host' button. When clicked, the button handler " +
      "MUST call `await Websandbox.connection.remote.notifyHost({ message: 'Hi from the sandbox!' })` " +
      "and then display the returned confirmation (including receivedAt timestamp) inside the card.",
  },
  {
    title: "Inline expression evaluator",
    message:
      "Build a tiny form with a text input and an 'Evaluate' button. When the user clicks " +
      "'Evaluate', call `await Websandbox.connection.remote.evaluateExpression({ expression })` with " +
      "the input value and render the returned result (or error.ok=false message) below the input.",
  },
];
