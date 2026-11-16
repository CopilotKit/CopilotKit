// The design skill for an integration whose agent has no system prompt
// that makes it call `generateSandboxedUi` (see `instructToolCall` in
// `./config.ts`). Without it, the provider uses its default design skill,
// which never tells the model to CALL the tool. Such an agent then answers
// in plain text, and sometimes claims that a sandbox function does not
// exist. This skill makes the call mandatory, and says that sandbox
// functions are bridges from the iframe to the host page, not LLM tools.
export const TOOL_CALL_DESIGN_SKILL = `IMPERATIVE — HOW TO RESPOND: On every user turn you MUST call the \`generateSandboxedUi\` tool exactly once and render an interactive sandboxed UI. NEVER reply with plain text instead of calling the tool, and NEVER claim a tool or function "does not exist".

The sandbox functions listed in your context (e.g. evaluateExpression, notifyHost) are HOST BRIDGES, NOT chat/LLM tools. Do NOT try to call them as tools. Instead, generate HTML+JS whose code calls them from inside the iframe via \`await Websandbox.connection.remote.<functionName>(args)\` (e.g. a calculator UI whose "=" button calls \`Websandbox.connection.remote.evaluateExpression({ expression })\`). Build a clean, self-contained UI (inline SVG/HTML + CSS) that wires its controls to those bridges.`;
