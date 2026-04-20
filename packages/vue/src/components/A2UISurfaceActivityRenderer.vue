<script setup lang="ts">
import { computed } from "vue";
import type { ActivityMessage } from "@ag-ui/core";
import type { A2UITheme } from "../types";
import type { A2UIOperation } from "./a2ui";
import { getOperationSurfaceId } from "./a2ui";

const props = defineProps<{
  activityType: string;
  content: { operations: A2UIOperation[] };
  message: ActivityMessage;
  agent?: object;
  theme?: A2UITheme;
}>();

const groupedOperations = computed(() => {
  const groups = new Map<string, A2UIOperation[]>();
  for (const operation of props.content.operations ?? []) {
    const surfaceId = getOperationSurfaceId(operation);
    const existing = groups.get(surfaceId);
    if (existing) {
      existing.push(operation);
    } else {
      groups.set(surfaceId, [operation]);
    }
  }
  return Array.from(groups.entries());
});
</script>

<template>
  <div
    v-if="groupedOperations.length > 0"
    data-copilotkit
    class="cpk:flex cpk:min-h-0 cpk:flex-1 cpk:flex-col cpk:gap-3 cpk:overflow-auto cpk:rounded-xl cpk:border cpk:border-border/70 cpk:bg-muted/20 cpk:p-3"
    data-testid="a2ui-activity-renderer"
    :data-activity-type="activityType"
    :data-message-id="message.id"
  >
    <section
      v-for="[surfaceId, operations] in groupedOperations"
      :key="surfaceId"
      class="cpk:rounded-lg cpk:border cpk:border-border/60 cpk:bg-background cpk:p-3"
      data-testid="a2ui-surface"
      :data-surface-id="surfaceId"
    >
      <header
        class="cpk:mb-2 cpk:flex cpk:items-center cpk:justify-between cpk:gap-2"
      >
        <strong
          class="cpk:text-xs cpk:font-semibold cpk:uppercase cpk:tracking-wide cpk:text-muted-foreground"
        >
          Surface {{ surfaceId }}
        </strong>
        <span class="cpk:text-xs cpk:text-muted-foreground">
          {{ operations.length }} op{{ operations.length === 1 ? "" : "s" }}
        </span>
      </header>
      <pre
        class="cpk:overflow-auto cpk:rounded-md cpk:border cpk:border-border/50 cpk:bg-muted/30 cpk:p-2 cpk:text-[11px] cpk:leading-relaxed cpk:text-foreground"
        >{{ JSON.stringify(operations, null, 2) }}</pre
      >
    </section>
  </div>
</template>
