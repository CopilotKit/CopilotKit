"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import type { PartnerShowcaseDemo } from "@/lib/partner-showcase-demos";

type Feature = {
  id: string;
  title: string;
  description: string;
  href?: string;
  embedHref?: string;
  video?: string;
  guide?: string;
};

const FEATURE_GUIDES: Record<string, string> = {
  "agentic-chat": "/prebuilt-components",
  "gen-ui-tool-based": "/generative-ui/tool-rendering",
  "hitl-in-chat": "/human-in-the-loop/tool-based",
  "shared-state-read-write": "/shared-state",
  "frontend-tools": "/frontend-tools",
  "headless-complete": "/custom-look-and-feel/headless-ui",
  subagents: "/multi-agent/subagents",
  "background-agents": "/background-tasks",
  "declarative-gen-ui": "/generative-ui/a2ui",
};

function FeatureFrame({
  feature,
  guideHref,
  frameworkName,
  onOpenDemo,
}: {
  onOpenDemo?: (href: string) => void;
  feature: Feature;
  guideHref: string;
  frameworkName: string;
}) {
  const [status, setStatus] = useState<"loading" | "slow" | "ready">("loading");
  useEffect(() => {
    const timer = setTimeout(
      () => setStatus((current) => (current === "ready" ? current : "slow")),
      10000,
    );
    return () => clearTimeout(timer);
  }, []);
  const src =
    feature.embedHref ?? `https://www.loom.com/embed/${feature.video}`;
  return (
    <div className="partner-explorer-frame">
      <iframe
        src={src}
        title={
          feature.href
            ? `${frameworkName}: ${feature.title} live demo`
            : `${feature.title} product walkthrough`
        }
        loading="eager"
        className={
          feature.href ? "partner-demo-iframe" : "partner-recording-iframe"
        }
        allow="clipboard-write; fullscreen; picture-in-picture"
        allowFullScreen
        onLoad={() => setStatus("ready")}
        onError={() => setStatus("slow")}
      />
      {status !== "ready" && (
        <div className="partner-demo-loading" role="status">
          <strong>
            {status === "loading"
              ? `Loading ${feature.title}…`
              : "The preview is taking a little longer."}
          </strong>
          {status === "slow" && (
            <a
              href={feature.href ?? src}
              target="_blank"
              rel="noreferrer"
              onClick={() => {
                if (feature.href) onOpenDemo?.(feature.href);
              }}
            >
              Open {feature.href ? "demo" : "walkthrough"} in a new tab{" "}
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          )}
        </div>
      )}
      <Link
        className="partner-demo-guide"
        href={guideHref}
        aria-label={`Get started with ${feature.title}`}
      >
        Get started <ArrowUpRight size={16} aria-hidden="true" />
      </Link>
    </div>
  );
}

export function PartnerFeatureExplorer({
  demos,
  hrefPrefix,
  frameworkName,
  onOpenDemo,
}: {
  demos: PartnerShowcaseDemo[];
  hrefPrefix: string;
  frameworkName: string;
  onOpenDemo?: (href: string) => void;
}) {
  const features: Feature[] = [
    {
      id: "threads",
      title: "Rich Threads",
      description: "Keep conversations, UI, and tool activity across sessions.",
      video: "79817778d29e490c97225127d2f17b3a",
      guide: "/threads",
    },
    {
      id: "learning",
      title: "Automatic Learning",
      description: "Turn past interactions into improvements you can review.",
      video: "2978fbfe42324e509057ac5fd46b7a70",
      guide: "/learning",
    },
    ...[...demos].sort(
      (a, b) =>
        Number(b.id === "gen-ui-tool-based") -
        Number(a.id === "gen-ui-tool-based"),
    ),
  ];
  const [selected, setSelected] = useState(
    demos.find((demo) => demo.id === "gen-ui-tool-based")?.id ??
      demos[0]?.id ??
      "threads",
  );
  const active =
    features.find((feature) => feature.id === selected) ?? features[0];
  const track = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = features.indexOf(active);
  function select(index: number, focus = false) {
    const next = (index + features.length) % features.length;
    setSelected(features[next].id);
    const button = buttons.current[next];
    const strip = track.current;
    if (button && strip) {
      strip.scrollTo({
        left:
          button.offsetLeft -
          strip.offsetLeft -
          (strip.clientWidth - button.clientWidth) / 2,
        behavior: "instant",
      });
      if (focus) button.focus({ preventScroll: true });
    }
  }
  return (
    <section
      className="partner-explorer"
      aria-label={`${frameworkName} features and demos`}
    >
      <FeatureFrame
        key={active.id}
        onOpenDemo={onOpenDemo}
        feature={active}
        guideHref={`${hrefPrefix}${active.guide ?? (hrefPrefix.startsWith("/angular/") ? `/features#${active.id}` : (FEATURE_GUIDES[active.id] ?? "/quickstart"))}`}
        frameworkName={frameworkName}
      />
      <div
        className="partner-feature-carousel"
        aria-label="Feature carousel"
        aria-roledescription="carousel"
      >
        <button
          type="button"
          className="partner-carousel-arrow"
          aria-label="Previous feature"
          onClick={() => select(activeIndex - 1)}
        >
          <ChevronLeft size={18} />
        </button>
        <div
          className="partner-feature-track"
          ref={track}
          role="group"
          aria-label="Choose a feature"
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
              event.preventDefault();
              select(activeIndex + (event.key === "ArrowRight" ? 1 : -1), true);
            }
          }}
        >
          {features.map((feature, index) => (
            <button
              key={feature.id}
              ref={(element) => {
                buttons.current[index] = element;
              }}
              type="button"
              aria-pressed={active.id === feature.id}
              onClick={() => select(index)}
            >
              {feature.title}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="partner-carousel-arrow"
          aria-label="Next feature"
          onClick={() => select(activeIndex + 1)}
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </section>
  );
}
