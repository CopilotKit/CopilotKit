import setupContentData from "@/data/setup-content.json";
import { channelConnectHref } from "./channel-guide-routes";
import type { ChannelsActivationBackendOption } from "./channels-activation-contracts";
import { compareByDisplayOrder } from "./framework-order";
import { resolveBundledSetupConcept } from "./setup-content";
import type { SetupContentBundle } from "./setup-content";
import { getDocsMode, getIntegrations, ROOT_FRAMEWORK } from "./registry";

const setupContent = setupContentData as SetupContentBundle;

/**
 * Return only backends represented by Shell Docs' public framework navigation
 * that also have a real Channels setup guide in the bundled documentation.
 * This deliberately does not inspect installed SDK packages or provider
 * adapters, which may exist before their documentation is ready to publish.
 */
export function getChannelsActivationBackendOptions(): ChannelsActivationBackendOption[] {
  return getIntegrations()
    .filter(
      ({ slug }) =>
        getDocsMode(slug) !== "hidden" &&
        resolveBundledSetupConcept(
          slug,
          "channels-agent-setup",
          setupContent,
        ) !== null,
    )
    .sort((a, b) => {
      if (a.slug === ROOT_FRAMEWORK) return -1;
      if (b.slug === ROOT_FRAMEWORK) return 1;
      return compareByDisplayOrder(a.slug, b.slug);
    })
    .map((integration) => ({
      slug: integration.slug,
      label:
        integration.slug === ROOT_FRAMEWORK ? "CopilotKit" : integration.name,
      logo: integration.logo ?? null,
      guideHrefs: {
        slack: channelConnectHref("slack", integration.slug),
        teams: channelConnectHref("teams", integration.slug),
      },
    }));
}
