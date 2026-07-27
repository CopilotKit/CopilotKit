/** @type {import('next').NextConfig} */
const nextConfig = {
  // React StrictMode intentionally double-invokes mount effects in DEV ONLY.
  // For CopilotKit's AG-UI human-in-the-loop flow that double-mount tears the
  // in-flight run down the instant the agent emits a HITL tool call — before
  // the approval card can render and return its result — which orphans the tool
  // call ("Tool result is missing for tool call …") and then poisons the thread
  // so every later message fails. Production builds never double-invoke, so the
  // bug is purely a `next dev` artifact; disabling StrictMode makes the live
  // HITL chat (and the teach-mode demonstration arc) work when the demo is run
  // via `next dev`. No effect on production behavior or correctness.
  reactStrictMode: false,
};

export default nextConfig;
