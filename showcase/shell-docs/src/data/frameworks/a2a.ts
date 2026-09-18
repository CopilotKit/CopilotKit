// Hand-maintained landing-page content for this framework's `/<slug>` route,
// read through `frameworkOverviews`. An earlier header credited
// `scripts/extract-framework-overviews.ts`; no such script exists in this
// repository and none ever has, so edit this file directly.
//
// A2A is the one partner with no showcase integration of its own, so this
// record carries no `showcase` block and the page ends after "Connect your
// agent". It also documents exactly one capability; a second and third card
// would have to be invented, and the section renders what is there.
import type { FrameworkOverviewData } from "./types";

const data: FrameworkOverviewData = {
  slug: "a2a",
  frameworkName: "A2A",
  iconKey: "a2a",
  header: "Bring your A2A agents to your users",
  subheader:
    "A2A connects your agents to each other. CopilotKit gives them a surface your users can see and steer.",
  guideLink: "/a2a/quickstart",
  // The org was `copilotkit-ai`, which 404s. The repository is under
  // `CopilotKit`, so the command on the page could not be pasted and run.
  initCommand: "git clone https://github.com/CopilotKit/with-a2a-a2ui.git",
  featuresLink: "https://feature-viewer.copilotkit.ai/a2a/feature/a2ui",

  lede: "A2A gives your agents a protocol for talking to each other. What it does not give you is the surface your users talk through. The capability below builds on what your A2A agents already emit.",
  supportedFeatures: [
    {
      title: "Declarative UI",
      iconKey: "paintbrush",
      description:
        "Your agents describe what to show rather than how to render it. CopilotKit turns those A2UI descriptions into React components in your own app.",
      documentationLink: "/a2a/generative-ui",
    },
  ],
  capabilitiesFootnote: {
    text: "Chat surfaces, headless UI, frontend tools and shared state work with A2A too.",
    linkLabel: "And more",
    href: "/a2a/build-with-agents",
  },

  connect: {
    intro:
      "A2A setup starts from a working example rather than a snippet: clone the repository below, then follow the quickstart to point it at your own agents.",
    filename: "",
    guideLink: "/a2a/quickstart",
    initCommand: "git clone https://github.com/CopilotKit/with-a2a-a2ui.git",
  },

  liveDemos: [],
};

export default data;
