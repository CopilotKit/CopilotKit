/**
 * Suggestion prompts surfaced in the chat composer. Each suggestion
 * explicitly asks the agent to produce an interactive sandboxed UI that
 * calls one of the host-side sandbox functions (see `sandbox-functions.ts`).
 */
export const openGenUiSuggestions = [
  {
    title: "Calculator (calls evaluateExpression)",
    message:
      "Build a modern calculator UI. Do NOT use a <form> element or type='submit' buttons. Use <button type='button'> with click handlers. " +
      "When the user presses '=', the handler MUST `await Websandbox.connection.remote.evaluateExpression({ expression })` " +
      "with the current display expression, then read `res.value` (when `res.ok` is true) and update the display.",
  },
  {
    title: "Ping the host (calls notifyHost)",
    message:
      "Build a simple card with a single 'Say hi to the host' button (type='button', NO <form>). " +
      "When clicked, the handler MUST `await Websandbox.connection.remote.notifyHost({ message: 'Hi from the sandbox!' })` " +
      "and then display the returned confirmation object inside the card.",
  },
  {
    title: "Inline expression evaluator",
    message:
      "Build a tiny UI with a text input and an 'Evaluate' button. Do NOT wrap them in a <form>. Use <button type='button'> with addEventListener. " +
      "When clicked, read the input value, call `Websandbox.connection.remote.evaluateExpression({ expression })`, and render the result.",
  },
];
