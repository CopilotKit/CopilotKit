import { createChannel, HttpAgent } from "@copilotkit/channels";
import { createChannelA2UIComponent } from "@copilotkit/channels/a2ui";
import { createMarketSnapshotCatalog } from "./market-snapshot.js";

export interface CreateMarketChannelOptions {
  readonly channelName: string;
  readonly agentUrl: string;
}

export function createMarketChannel(options: CreateMarketChannelOptions) {
  const component = createChannelA2UIComponent({
    catalog: createMarketSnapshotCatalog(),
    async onAction({ action, interaction }) {
      await interaction.thread.runAgent({
        prompt:
          `The user performed the interface action "${action.name}". ` +
          "Acknowledge it briefly without searching or rendering another interface.",
      });
    },
  });
  const channel = createChannel({
    name: options.channelName,
    identifyUser: "platform",
    showToolStatus: true,
    agent: (threadId) => {
      const agent = new HttpAgent({ url: options.agentUrl });
      agent.threadId = threadId;
      return agent;
    },
    components: [component],
  });

  channel.onMention(async ({ thread, message }) => {
    await thread.runAgent({ prompt: message.text });
  });
  return channel;
}
