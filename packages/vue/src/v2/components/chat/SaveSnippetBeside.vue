<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  SAVE_SNIPPET_BESIDE_BODY_CLASS,
  SAVE_SNIPPET_BESIDE_SAVE_CLASS,
  SAVE_SNIPPET_BESIDE_WRAP_CLASS,
  findOverflowAncestor,
  measureSaveSnippetSide,
  saveSnippetBesideStyle,
} from "./save-snippet-beside";

const props = defineProps<{
  enabled: boolean;
}>();

const wrapRef = ref<HTMLElement | null>(null);
const bodyRef = ref<HTMLElement | null>(null);
const side = ref<"left" | "right">("right");
let observer: ResizeObserver | undefined;

function measure() {
  const wrap = wrapRef.value;
  const body = bodyRef.value;
  if (!props.enabled || !wrap || !body) {
    return;
  }
  side.value = measureSaveSnippetSide(wrap, body);
}

function bindObserver() {
  observer?.disconnect();
  const wrap = wrapRef.value;
  const body = bodyRef.value;
  if (!props.enabled || !wrap || !body) {
    return;
  }
  measure();
  if (typeof ResizeObserver === "undefined") {
    return;
  }
  observer = new ResizeObserver(measure);
  observer.observe(wrap);
  observer.observe(body);
  const clip = findOverflowAncestor(wrap);
  if (clip !== wrap) {
    observer.observe(clip);
  }
}

onMounted(() => {
  watch([wrapRef, bodyRef, () => props.enabled], () => bindObserver(), {
    flush: "post",
    immediate: true,
  });
  window.addEventListener("resize", measure);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  window.removeEventListener("resize", measure);
});
</script>

<template>
  <slot v-if="!enabled" />
  <div
    v-else
    ref="wrapRef"
    :class="SAVE_SNIPPET_BESIDE_WRAP_CLASS"
    :data-save-snippet-side="side"
  >
    <div ref="bodyRef" :class="SAVE_SNIPPET_BESIDE_BODY_CLASS">
      <slot />
    </div>
    <div
      :class="SAVE_SNIPPET_BESIDE_SAVE_CLASS"
      :style="saveSnippetBesideStyle(side)"
    >
      <slot name="save" />
    </div>
  </div>
</template>
