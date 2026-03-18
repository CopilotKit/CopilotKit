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
    class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto rounded-xl border border-border/70 bg-muted/20 p-3"
    data-testid="a2ui-activity-renderer"
    :data-activity-type="activityType"
    :data-message-id="message.id"
  >
    <section
      v-for="[surfaceId, operations] in groupedOperations"
      :key="surfaceId"
      class="rounded-lg border border-border/60 bg-background p-3"
      data-testid="a2ui-surface"
      :data-surface-id="surfaceId"
    >
      <header class="mb-2 flex items-center justify-between gap-2">
        <strong class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Surface {{ surfaceId }}
        </strong>
        <span class="text-xs text-muted-foreground">
          {{ operations.length }} op{{ operations.length === 1 ? "" : "s" }}
        </span>
      </header>
      <pre
        class="overflow-auto rounded-md border border-border/50 bg-muted/30 p-2 text-[11px] leading-relaxed text-foreground"
      >{{ JSON.stringify(operations, null, 2) }}</pre>
    </section>
  </div>
</template>
