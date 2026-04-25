/**
 * Suggestion prompts surfaced in the chat composer.
 */
export const openGenUiSuggestions = [
  {
    title: "Calculator (calls evaluateExpression)",
    message:
      "Build a modern calculator UI. Do NOT use a <form> element or type='submit' buttons " +
      "(the sandbox blocks form submissions). Use <button type='button'> with click handlers. " +
      "When the user presses '=', the handler MUST `await " +
      "Websandbox.connection.remote.evaluateExpression({ expression })` with the current " +
      "display expression, then read `res.value` (when `res.ok` is true) and update the display " +
      "to that number. Show the history of computed values below the display.",
  },
  {
    title: "Ping the host (calls notifyHost)",
    message:
      "Build a simple card with a single 'Say hi to the host' button (type='button', NO <form>). " +
      "When clicked, the handler MUST `await " +
      "Websandbox.connection.remote.notifyHost({ message: 'Hi from the sandbox!' })` and then " +
      "display the returned confirmation object (including `receivedAt` timestamp) inside the card.",
  },
];
