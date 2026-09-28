<script setup lang="ts">
import { inject } from "vue";
import CopilotChatConfigurationProvider from "./CopilotChatConfigurationProvider.vue";
import { CopilotChatConfigurationKey } from "./keys";

/**
 * Gives a chat modal's chat and its threads drawer (`<CopilotPopup
 * threads-drawer>` / `<CopilotSidebar threads-drawer>`) a chat configuration
 * to switch threads through. An app that already provides one keeps it;
 * without one, a thread picked in the drawer would never reach the chat.
 *
 * `threadId` is the modal's own prop, so clearing it starts a fresh thread
 * instead of going back to the one minted at mount.
 */
defineProps<{ enabled: boolean; threadId?: string }>();

const hasParentConfig = inject(CopilotChatConfigurationKey, null) !== null;
</script>

<template>
  <CopilotChatConfigurationProvider
    v-if="enabled && !hasParentConfig"
    :thread-id="threadId"
  >
    <slot />
  </CopilotChatConfigurationProvider>
  <slot v-else />
</template>
