/** Shared generation contract for all Open Generative UI renderers. */
export const GENERATE_SANDBOXED_UI_DESCRIPTION =
  "Generate sandboxed UI. " +
  "IMPORTANT: The generated code runs in a sandboxed iframe WITHOUT same-origin access. " +
  "Do NOT use localStorage, sessionStorage, document.cookie, IndexedDB, or fetch/XMLHttpRequest to same-origin URLs. " +
  "To communicate with the host application, use Websandbox.connection.remote.<functionName>(args) which returns a Promise.\n\n" +
  "You CAN use external libraries from CDNs by including <script> or <link> tags in the HTML <head> (e.g., Chart.js, D3, Three.js, x-data-spreadsheet, etc.). " +
  "CDN resources load normally inside the sandbox.\n\n" +
  "PARAMETER ORDER IS CRITICAL — generate parameters in exactly this order:\n" +
  "1. initialHeight + placeholderMessages (shown to user while generating)\n" +
  "2. css (all styles FIRST — the user sees a placeholder until CSS is complete)\n" +
  "3. html (streams in live — the user watches the UI build as HTML is generated)\n" +
  "4. jsFunctions (reusable helper functions)\n" +
  "5. jsExpressions (applied one-by-one — the user sees each expression take effect)" +
  "\n\nINITIALIZATION CONTRACT: jsFunctions and jsExpressions run after the final HTML DOM is ready, in both live generation and saved-thread replay. " +
  "Define reusable functions in jsFunctions, then initialize the UI directly in the first jsExpressions entry (for example, initializeCalculator()). " +
  "Attach click/keyboard handlers and set initial display values there. Do NOT wait for DOMContentLoaded, window.onload, or the load event in jsFunctions or jsExpressions: these events may already have fired. " +
  "Each expression is executed once per rendered sandbox; later expressions must not repeat initialization or reattach the same handlers. " +
  "Keep initialization self-contained so a new sandbox can reconstruct the UI when a saved thread is opened. If a library loads asynchronously, initialize from its explicit load promise instead of waiting for document readiness.\n\n" +
  "INTERACTION CONTRACT: Every visible interactive control needs a working handler, including controls created during initialization. If the handlers are supplied through jsFunctions/jsExpressions, initialize them in the first expression; if supplied by an inline HTML script, ensure it runs when the final sandbox mounts and replays. Every user action must update the visible UI to reflect its completed result, including success and error paths. Changing a JavaScript variable alone does not update the DOM. After changing state, call the rendering function or update the displayed element directly. When delegating clicks from a parent element, resolve the clicked control with closest('button') so clicks on nested labels and values work. For a calculator, pressing = must replace the visible expression with the computed answer; metric shortcuts must visibly insert their values. Trace each button handler through its final display update before emitting the tool call.";
