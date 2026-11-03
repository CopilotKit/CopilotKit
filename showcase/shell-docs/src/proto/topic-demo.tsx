"use client";

import { DemoFrame } from "@/components/demo-frame";
import { useSiteHosts } from "@/components/site-hosts";
import { frameworkById, type TopicSlug } from "./data";
import { EXAMPLES, demoSourceUrl, demoUrl } from "./examples";

/** Each topic's live showcase demo (a feature id in `EXAMPLES`). */
const TOPIC_DEMO: Partial<Record<TopicSlug, string>> = {
  quickstart: "agentic-chat",
  "generative-ui": "gen-ui-tool-based",
  "human-in-the-loop": "hitl-in-chat",
  "shared-state": "shared-state-read-write",
};

/**
 * The topic's real showcase demo, running on the reader's framework (or the
 * first framework that has it), in the docs' demo frame.
 */
export function TopicDemo({
  topic,
  framework,
}: {
  topic: TopicSlug;
  framework: string;
}) {
  const hosts = useSiteHosts();
  const feature = EXAMPLES.find((f) => f.id === TOPIC_DEMO[topic]);
  if (!feature) return null;
  const fw = feature.frameworks.includes(framework)
    ? framework
    : feature.frameworks[0];
  const demo = feature.demos[fw];
  const name = frameworkById(fw)?.name ?? fw;
  return (
    <DemoFrame
      src={demoUrl(hosts, fw, demo)}
      title={`${feature.name}, running on ${name}`}
      label={feature.name}
      sourceHref={demoSourceUrl(fw, demo)}
    />
  );
}
