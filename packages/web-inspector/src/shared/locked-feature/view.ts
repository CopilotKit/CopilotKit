import { html } from "lit";
import type { TemplateResult } from "lit";

import type { LockedFeatureOutlineItem } from "./copy.js";

export type LockedFeatureServiceId = "threads" | "memory";

export type LockedFeatureOverviewInput = Readonly<{
  serviceId: LockedFeatureServiceId;
  featureName: string;
  heading: string;
  description: string;
  videoUrl: string;
  videoTitle: string;
  outlineItems: ReadonlyArray<LockedFeatureOutlineItem>;
  setupPrompt: unknown;
  talkToEngineerUrl: string;
  featureIcon: unknown;
  renderIcon: (name: string) => unknown;
  onTalkToEngineer: () => void;
}>;

export function renderLockedFeatureOverview(
  input: LockedFeatureOverviewInput,
): TemplateResult {
  return html`
    <div
      class="cpk-locked-feature"
      data-inspector-locked-feature=${input.serviceId}
    >
      <div class="cpk-locked-feature-layout">
        <div class="cpk-locked-feature-hero">
          <div class="cpk-locked-feature-copy">
            <div class="cpk-locked-feature-name">
              <span class="cpk-locked-feature-icon" aria-hidden="true">
                ${input.featureIcon}
              </span>
              ${input.featureName}
            </div>
            <h2 class="cpk-locked-feature-title">${input.heading}</h2>
            <p class="cpk-locked-feature-description">${input.description}</p>
            <div class="cpk-threads-overview-actions">
              ${input.setupPrompt}
              <a
                data-inspector-locked-feature-talk=${input.serviceId}
                href=${input.talkToEngineerUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Talk to an Engineer (opens in a new tab)"
                class="cpk-threads-overview-action cpk-threads-overview-action-secondary"
                @click=${input.onTalkToEngineer}
              >
                Talk to an Engineer
              </a>
            </div>
          </div>
          <div class="cpk-locked-feature-media">
            <div
              class="cpk-threads-overview-video-frame cpk-locked-feature-video"
            >
              <iframe
                class="cpk-threads-overview-video-embed"
                data-inspector-feature-video=${input.serviceId}
                src=${input.videoUrl}
                title=${input.videoTitle}
                loading="lazy"
                allow="fullscreen; picture-in-picture"
                allowfullscreen
              ></iframe>
            </div>
          </div>
        </div>
        <section
          class="cpk-locked-feature-outline"
          data-inspector-feature-outline=${input.serviceId}
          aria-label="${input.featureName} capabilities"
        >
          <div class="cpk-locked-feature-outline-list">
            ${input.outlineItems.map(
              (item) => html`
                <section class="cpk-locked-feature-outline-item">
                  <h3>
                    <span
                      class="cpk-locked-feature-outline-icon"
                      aria-hidden="true"
                    >
                      ${input.renderIcon(item.icon)}
                    </span>
                    ${item.title}
                  </h3>
                  <p>${item.description}</p>
                </section>
              `,
            )}
          </div>
        </section>
      </div>
    </div>
  `;
}
