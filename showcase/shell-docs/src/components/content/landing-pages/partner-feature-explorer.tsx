"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { PartnerShowcaseDemo } from "@/lib/partner-showcase-demos";

type Feature = {
  id: string;
  title: string;
  description: string;
  href?: string;
  video?: string;
  guide?: string;
};

function FeatureFrame({
  feature,
  frameworkName,
}: {
  feature: Feature;
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
  const src = feature.href
    ? `${feature.href}/preview`
    : `https://www.loom.com/embed/${feature.video}`;
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
            <a href={feature.href ?? src} target="_blank" rel="noreferrer">
              Open {feature.href ? "demo" : "walkthrough"} in a new tab{" "}
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          )}
        </div>
      )}
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
  return (
    <section
      className="partner-explorer"
      aria-label={`${frameworkName} features and demos`}
    >
      <FeatureFrame
        key={active.id}
        feature={active}
        frameworkName={frameworkName}
      />
      <div className="partner-explorer-caption">
        <div>
          <strong>{active.title}</strong>
          <p>{active.description}</p>
        </div>
        <div className="partner-explorer-links">
          {active.guide && (
            <Link href={`${hrefPrefix}${active.guide}`}>
              Read guide <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          )}
          {active.href ? (
            <a
              href={active.href}
              target="_blank"
              rel="noreferrer"
              onClick={() => {
                if (active.href) onOpenDemo?.(active.href);
              }}
            >
              Open demo <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          ) : (
            <span>Product walkthrough</span>
          )}
        </div>
      </div>
      <div
        className="partner-feature-list"
        role="group"
        aria-label="Choose a feature"
      >
        {features.map((feature, index) => (
          <button
            key={feature.id}
            type="button"
            aria-pressed={active.id === feature.id}
            className={index < 3 ? "partner-feature-primary" : undefined}
            onClick={() => setSelected(feature.id)}
          >
            {feature.title}
          </button>
        ))}
      </div>
    </section>
  );
}
