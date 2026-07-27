<!-- @region[headless-agent-ui] -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { useAgent, useCopilotKit, UseAgentUpdate } from "@copilotkit/vue/v2";

const input = ref("");
const { copilotkit } = useCopilotKit();
const { agent } = useAgent({
  agentId: "default",
  updates: [
    UseAgentUpdate.OnMessagesChanged,
    UseAgentUpdate.OnRunStatusChanged,
  ],
});

const messages = computed(() => agent.value?.messages ?? []);
const isRunning = computed(() => agent.value?.isRunning ?? false);

async function sendMessage() {
  const currentAgent = agent.value;
  const content = input.value.trim();
  if (!currentAgent || !content || currentAgent.isRunning) return;

  currentAgent.addMessage({
    id: crypto.randomUUID(),
    role: "user",
    content,
  });
  input.value = "";

  await copilotkit.value.runAgent({ agent: currentAgent });
}

function stop() {
  const currentAgent = agent.value;
  if (currentAgent) {
    copilotkit.value.stopAgent({ agent: currentAgent });
  }
}
</script>

<template>
  <section class="custom-agent-ui">
    <ol aria-live="polite">
      <li v-for="message in messages" :key="message.id">
        <strong>{{ message.role }}:</strong> {{ message.content }}
      </li>
    </ol>

    <p v-if="isRunning">Thinking…</p>

    <form @submit.prevent="sendMessage">
      <label>
        Message
        <input v-model="input" :disabled="!agent || isRunning" />
      </label>
      <button type="submit" :disabled="!agent || isRunning">Send</button>
      <button v-if="isRunning" type="button" @click="stop">Stop</button>
    </form>
  </section>
</template>
<!-- @endregion[headless-agent-ui] -->
