import type { FrameworkOverviewData } from "./types";

const data: FrameworkOverviewData = {
  slug: "google-antigravity",
  frameworkName: "Google Antigravity",
  // Placeholder: no Antigravity mark exists in the icon registry yet, so this
  // reuses the ADK icon — the same placeholder treatment PARITY_NOTES.md
  // records for `shell/public/logos/google-antigravity.svg` (a copy of
  // `google-adk.svg` until a real, permissively-licensed mark is available).
  iconKey: "adk",
  header: "Bring your Google Antigravity agents to your users",
  subheader:
    "Connect Google Antigravity's harness-backed agents to CopilotKit with AG-UI through the ag-ui-antigravity adapter — frontend tools, human-in-the-loop approvals, and generative UI tool rendering all stream over the same protocol your app already speaks.",
  bannerVideo:
    "https://cdn.copilotkit.ai/docs/copilotkit/videos/coagents/overview.mp4",
  guideLink: "/google-antigravity/quickstart",
  initCommand: "npx copilotkit@latest init --framework google-antigravity",
  // The showcase package is not deployed yet (`deployed: false` in its
  // manifest), so the feature and demo links point at the source until the
  // showcase URLs exist; switch them (and restore `liveDemos`) at deploy time.
  featuresLink:
    "https://github.com/CopilotKit/CopilotKit/tree/main/showcase/integrations/google-antigravity",
  supportedFeatures: [
    {
      title: "Frontend tools",
      description:
        "Every tool your frontend registers becomes a real Antigravity tool. A call parks as an awaited coroutine across HTTP runs until the browser resolves it, so the model sees the tool's actual return value — no proxy tool, no long-running-tool workaround.",
      documentationLink: "/google-antigravity/frontend-tools",
      videoUrl:
        "https://cdn.copilotkit.ai/docs/copilotkit/videos/coagents/haiku.mp4",
    },
    {
      title: "Human in the loop",
      description:
        "Antigravity's hooks are async and awaited with no timeout, so an approval or input request just parks the run: the SSE stream for that turn closes, and CopilotKit resumes it on the next run once the user responds.",
      documentationLink: "/google-antigravity/human-in-the-loop",
      videoUrl:
        "https://cdn.copilotkit.ai/docs/copilotkit/images/coagents/human-in-the-loop-example.mp4",
    },
    {
      title: "Generative UI tool rendering",
      description:
        "Server-side tools like weather, flight search, and stock prices run in Python and their calls and results stream straight from the adapter, so CopilotKit's per-tool renderers can paint a custom card for each one.",
      documentationLink: "/google-antigravity/generative-ui/tool-rendering",
      videoUrl:
        "https://cdn.copilotkit.ai/docs/copilotkit/videos/coagents/shared-state.mp4",
    },
  ],
  architectureImage:
    "https://cdn.copilotkit.ai/docs/copilotkit/images/generic-agui-architecture.png",
  liveDemos: [],
};

export default data;
