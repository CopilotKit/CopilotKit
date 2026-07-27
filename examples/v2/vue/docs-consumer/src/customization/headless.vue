<!-- @region[headless-chat-view] -->
<script setup lang="ts">
import { ref } from "vue";
import { CopilotChatView } from "@copilotkit/vue/v2";

const message = ref("");

function updateInput(event: Event, update: (value: string) => void) {
  if (event.target instanceof HTMLInputElement) {
    update(event.target.value);
  }
}
</script>

<template>
  <CopilotChatView
    :messages="[]"
    :is-running="false"
    :welcome-screen="false"
    :input-value="message"
    @input-change="message = $event"
  >
    <template #input="{ modelValue, onUpdateModelValue, onSubmitMessage }">
      <form @submit.prevent="onSubmitMessage(modelValue)">
        <input
          :value="modelValue"
          @input="updateInput($event, onUpdateModelValue)"
        />
        <button type="submit">Send</button>
      </form>
    </template>
  </CopilotChatView>
</template>
<!-- @endregion[headless-chat-view] -->
