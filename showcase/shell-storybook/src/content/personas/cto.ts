import type { Persona } from "../types";

export const cto = {
  slug: "cto",
  name: "CTO",
  group: "leadership",
  summary: "Understand the generated system, proof model, and ownership seams.",
  question:
    "Where does Showcase truth come from, and how do we keep it reliable?",
  minutes: 6,
  pages: [
    {
      slug: "system-in-one-picture",
      title: "The system in one picture",
      claim:
        "Generated truth organizes Showcase. Maintained demos provide the proof.",
      body: "Integration manifests and the shared feature registry describe what should exist. A generator turns those facts into shell data. Demos, tests, and deployment then prove whether each declared cell actually works.",
      composition: "diagram",
      visual: { kind: "system-map" },
      resources: [
        { kind: "curated", id: "showcase-source" },
        { kind: "curated", id: "frontend-strategy" },
      ],
    },
    {
      slug: "manifest-to-live-demo",
      title: "From manifest to live demo",
      claim: "A manifest declaration travels all the way to a public route.",
      body: "The manifest names the integration, features, demos, routes, and metadata. Generated registry data lets each shell discover that declaration without importing another app. The public shell then links people to the running proof.",
      composition: "diagram",
      visual: { kind: "manifest-flow" },
      resources: [
        { kind: "curated", id: "manifest-schema" },
        { kind: "curated", id: "registry-generator" },
      ],
    },
    {
      slug: "trustworthy-proof",
      title: "How proof becomes trustworthy",
      claim:
        "Trust comes from agreement between declaration, behavior, and tests.",
      body: "A green cell is meaningful only when the manifest describes reality, the demo uses the real integration path, and probes verify behavior. Showcase is strongest when those three layers fail together instead of drifting apart.",
      composition: "diagram",
      visual: { kind: "proof-flow" },
      resources: [
        { kind: "curated", id: "harness-source" },
        { kind: "curated", id: "coverage-matrix" },
      ],
    },
    {
      slug: "where-system-runs",
      title: "Where the system runs",
      claim:
        "Shells explain the system. Integration services run the examples.",
      body: "Each shell has its own audience and interface. Integration backends are deployed independently, while generated data keeps routes discoverable. This boundary lets the explanation layer change without hiding how a real agent integration behaves.",
      composition: "artifact",
      visual: { kind: "artifact", artifact: "deployment-map" },
      resources: [
        { kind: "curated", id: "build-workflow" },
        { kind: "curated", id: "frontend-strategy" },
      ],
    },
    {
      slug: "who-owns-each-seam",
      title: "Who owns each seam",
      claim:
        "Partnerships owns readiness. OSS owns the shared operating system.",
      body: "Partnerships Engineering takes an integration from first contact to launch-ready proof. OSS Engineering protects the common architecture, registry, shells, harness, and reliability. The handoff is explicit so partner context is not lost and shared code has a clear owner.",
      composition: "diagram",
      visual: { kind: "ownership-handoff", perspective: "oss" },
      resources: [
        { kind: "curated", id: "showcase-rules" },
        { kind: "curated", id: "showcase-source" },
      ],
    },
    {
      slug: "technical-operating-view",
      title: "Your technical operating view",
      claim: "Review Showcase as an evidence system with named seams.",
      body: "Keep the declaration, demo, test, and deployment layers visible in technical reviews. Ask for an owner and a proof link when coverage matters. Treat recurring drift as a system problem, not a series of isolated demo fixes.",
      composition: "action",
      visual: {
        kind: "checklist",
        items: [
          "Review owner boundaries quarterly",
          "Require proof for strategic coverage",
          "Fund reliability work",
        ],
      },
      resources: [
        { kind: "curated", id: "showcase-dashboard" },
        { kind: "curated", id: "harness-source" },
      ],
    },
  ],
} satisfies Persona;
