"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check } from "lucide-react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
} from "@/components/ui/carousel";
import type { CarouselApi } from "@/components/ui/carousel";
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
        Get started <ArrowUpRight size={12} aria-hidden="true" />
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
  const features: Feature[] = useMemo(
    () => [
      ...demos.filter((demo) => demo.id === "agentic-chat"),
      {
        id: "threads",
        title: "Rich Threads",
        description:
          "Keep conversations, UI, and tool activity across sessions.",
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
      ...demos
        .filter((demo) => demo.id !== "agentic-chat")
        .sort((a, b) => {
          const order = [
            "gen-ui-tool-based",
            "hitl-in-chat",
            "frontend-tools",
            "shared-state-read-write",
            "headless-complete",
            "subagents",
            "background-agents",
            "declarative-gen-ui",
          ];
          return order.indexOf(a.id) - order.indexOf(b.id);
        })
        .map((demo) =>
          demo.id === "hitl-in-chat"
            ? { ...demo, title: "Human-in-the-loop" }
            : demo,
        ),
    ],
    [demos],
  );
  const [selected, setSelected] = useState(
    demos.find((demo) => demo.id === "agentic-chat")?.id ??
      demos[0]?.id ??
      "threads",
  );
  const active =
    features.find((feature) => feature.id === selected) ?? features[0];
  const [api, setApi] = useState<CarouselApi>();
  const initialIndex = useRef(features.indexOf(active)).current;
  useEffect(() => {
    if (!api) return;
    const syncSelection = () => {
      const feature = features[api.selectedScrollSnap()];
      if (feature) setSelected(feature.id);
    };
    syncSelection();
    api.on("select", syncSelection);
    api.on("reInit", syncSelection);
    return () => {
      api.off("select", syncSelection);
      api.off("reInit", syncSelection);
    };
  }, [api, features]);
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
      <Carousel
        setApi={setApi}
        opts={{
          align: "center",
          containScroll: "keepSnaps",
          dragFree: true,
          startIndex: initialIndex,
        }}
        className="partner-feature-carousel"
        aria-label="Choose a feature"
      >
        <CarouselPrevious
          className="partner-carousel-arrow"
          aria-label="Previous feature"
          title="Previous feature"
        />
        <CarouselContent className="partner-feature-track">
          {features.map((feature, index) => (
            <CarouselItem key={feature.id} className="partner-feature-item">
              <button
                type="button"
                aria-pressed={active.id === feature.id}
                onClick={() => api?.scrollTo(index)}
              >
                <Check
                  size={14}
                  aria-hidden="true"
                  className={
                    active.id === feature.id ? "opacity-100" : "opacity-0"
                  }
                />
                {feature.title}
              </button>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselNext
          className="partner-carousel-arrow"
          aria-label="Next feature"
          title="Next feature"
        />
      </Carousel>
    </section>
  );
}
