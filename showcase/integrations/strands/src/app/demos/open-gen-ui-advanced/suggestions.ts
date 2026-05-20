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
      "to that number.",
  },
  {
    title: "Ping the host (calls notifyHost)",
    message:
      "Build a simple card with a single 'Say hi to the host' button (type='button', NO <form>). " +
      "When clicked, the handler MUST `await " +
      "Websandbox.connection.remote.notifyHost({ message: 'Hi from the sandbox!' })` and then " +
      "display the returned confirmation object inside the card.",
  },
  {
    title: "Inline expression evaluator",
    message:
      "Build a tiny UI with a text input and an 'Evaluate' button. IMPORTANT: do NOT wrap them in a " +
      "<form>, and do NOT use type='submit'. Use <button type='button'> wired with " +
      "addEventListener('click', ...). When clicked, read the input value, call `const res = await " +
      "Websandbox.connection.remote.evaluateExpression({ expression })`, and then render " +
      "`res.value` (if `res.ok === true`) or `res.error` (if `res.ok === false`) below the input.",
  },
];
