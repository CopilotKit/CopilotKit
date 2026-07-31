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

  // Hide Next's floating dev-tools badge (the "N" bottom-left that periodically
  // flashes "1 Issue"). It is a dev-only overlay, but this demo is PRESENTED
  // from `next dev`, so on stage it reads as a defect in our product and it
  // overlaps the chat's own bottom-left controls. Purely cosmetic: it disables
  // the indicator, not any checking.
  devIndicators: false,
};

export default nextConfig;
