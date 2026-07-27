<!-- @region[headless-thread-list] -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { useCopilotChatConfiguration, useThreads } from "@copilotkit/vue/v2";

const configuration = useCopilotChatConfiguration();
const agentId = computed(() => configuration.value?.agentId ?? "default");
const actionError = ref<string | null>(null);

const {
  threads,
  isLoading,
  listError,
  fetchMoreError,
  hasMoreThreads,
  isFetchingMoreThreads,
  isMutating,
  fetchMoreThreads,
  refetchThreads,
  startNewThread,
  renameThread,
  archiveThread,
  deleteThread,
} = useThreads({
  agentId,
  limit: 20,
});

function selectThread(threadId: string) {
  configuration.value?.setActiveThreadId(threadId, { explicit: true });
}

function newThread() {
  startNewThread();
  configuration.value?.startNewThread();
}

async function rename(threadId: string, currentName: string | null) {
  const name = window.prompt("Rename thread", currentName ?? "");
  if (!name?.trim()) return;
  await mutate(() => renameThread(threadId, name.trim()));
}

async function archive(threadId: string) {
  if (window.confirm("Archive this thread?")) {
    await mutate(() => archiveThread(threadId));
  }
}

async function remove(threadId: string) {
  if (!window.confirm("Permanently delete this thread?")) return;

  const wasActive = configuration.value?.threadId === threadId;
  await mutate(() => deleteThread(threadId));
  if (!actionError.value && wasActive) newThread();
}

async function mutate(action: () => Promise<void>) {
  actionError.value = null;
  try {
    await action();
  } catch (error) {
    actionError.value =
      error instanceof Error ? error.message : "The thread update failed.";
  }
}
</script>

<template>
  <nav aria-label="Conversation history">
    <button type="button" :disabled="isMutating" @click="newThread">
      New conversation
    </button>

    <p v-if="isLoading">Loading conversations…</p>
    <div v-else-if="listError" role="alert">
      <p>Could not load conversations: {{ listError.message }}</p>
      <button type="button" @click="refetchThreads">Try again</button>
    </div>
    <p v-else-if="threads.length === 0">No conversations yet.</p>

    <ul v-else>
      <li v-for="thread in threads" :key="thread.id">
        <button type="button" @click="selectThread(thread.id)">
          {{ thread.name ?? "Untitled conversation" }}
        </button>
        <button
          type="button"
          :disabled="isMutating"
          @click="rename(thread.id, thread.name)"
        >
          Rename
        </button>
        <button
          type="button"
          :disabled="isMutating"
          @click="archive(thread.id)"
        >
          Archive
        </button>
        <button type="button" :disabled="isMutating" @click="remove(thread.id)">
          Delete
        </button>
      </li>
    </ul>

    <div v-if="hasMoreThreads">
      <button
        type="button"
        :disabled="isFetchingMoreThreads"
        @click="fetchMoreThreads"
      >
        {{ isFetchingMoreThreads ? "Loading…" : "Load more" }}
      </button>
      <p v-if="fetchMoreError" role="alert">
        Could not load more: {{ fetchMoreError.message }}
      </p>
    </div>

    <p v-if="actionError" role="alert">{{ actionError }}</p>
  </nav>
</template>
<!-- @endregion[headless-thread-list] -->
