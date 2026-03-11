<script setup lang="ts">
import { computed, defineComponent, getCurrentInstance, h, onBeforeUnmount, onMounted, ref } from "vue";
import type { AssistantMessage, Message } from "@ag-ui/core";
import { StreamMarkdown } from "streamdown-vue";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import { CopilotChatDefaultLabels } from "../../providers/types";
import {
  IconCheck,
  IconCopy,
  IconDownload,
  IconRefreshCw,
  IconThumbsDown,
  IconThumbsUp,
  IconVolume2,
} from "../icons";
import CopilotChatToolCallsView from "./CopilotChatToolCallsView.vue";
import type {
  CopilotChatAssistantMessageCopyButtonSlotProps,
  CopilotChatAssistantMessageMessageRendererSlotProps,
  CopilotChatAssistantMessageReadAloudButtonSlotProps,
  CopilotChatAssistantMessageRegenerateButtonSlotProps,
  CopilotChatAssistantMessageThumbsDownButtonSlotProps,
  CopilotChatAssistantMessageThumbsUpButtonSlotProps,
  CopilotChatAssistantMessageToolCallsViewSlotProps,
  CopilotChatAssistantMessageToolbarSlotProps,
} from "./types";
import "katex/dist/katex.min.css";

const props = withDefaults(
  defineProps<{
    message: AssistantMessage;
    messages?: Message[];
    isRunning?: boolean;
    toolbarVisible?: boolean;
  }>(),
  {
    messages: () => [],
    isRunning: false,
    toolbarVisible: true,
  },
);

defineSlots<{
  "message-renderer"?: (props: CopilotChatAssistantMessageMessageRendererSlotProps) => unknown;
  toolbar?: (props: CopilotChatAssistantMessageToolbarSlotProps) => unknown;
  "copy-button"?: (props: CopilotChatAssistantMessageCopyButtonSlotProps) => unknown;
  "thumbs-up-button"?: (props: CopilotChatAssistantMessageThumbsUpButtonSlotProps) => unknown;
  "thumbs-down-button"?: (props: CopilotChatAssistantMessageThumbsDownButtonSlotProps) => unknown;
  "read-aloud-button"?: (props: CopilotChatAssistantMessageReadAloudButtonSlotProps) => unknown;
  "regenerate-button"?: (props: CopilotChatAssistantMessageRegenerateButtonSlotProps) => unknown;
  "tool-calls-view"?: (props: CopilotChatAssistantMessageToolCallsViewSlotProps) => unknown;
  "toolbar-items"?: () => unknown;
  [key: string]: ((props: any) => unknown) | undefined;
}>();

const emit = defineEmits<{
  "thumbs-up": [message: AssistantMessage];
  "thumbs-down": [message: AssistantMessage];
  "read-aloud": [message: AssistantMessage];
  regenerate: [message: AssistantMessage];
}>();

const config = useCopilotChatConfiguration();
const labels = computed(() => config.value?.labels ?? CopilotChatDefaultLabels);
const instance = getCurrentInstance();
const copied = ref(false);
let copiedResetTimeout: ReturnType<typeof setTimeout> | null = null;
const vnodeProps = computed(() => (instance?.vnode.props ?? {}) as Record<string, unknown>);

const toolbarButtonClass = [
  "inline-flex h-8 w-8 items-center justify-center rounded-md p-0",
  "cursor-pointer text-[rgb(93,93,93)] transition-colors hover:bg-[#E8E8E8]",
  "hover:text-[rgb(93,93,93)] dark:text-[rgb(243,243,243)] dark:hover:bg-[#303030]",
  "dark:hover:text-[rgb(243,243,243)] disabled:pointer-events-none disabled:opacity-50",
].join(" ");

function extractFileNameFromUrl(url: string, fallback: string) {
  try {
    const parsed = new URL(url, "https://copilotkit.local");
    const pathname = parsed.pathname.split("/").filter(Boolean).pop();
    if (pathname) {
      return decodeURIComponent(pathname);
    }
  } catch {
    return fallback;
  }
  return fallback;
}

function triggerDownload(href: string, fileName: string) {
  if (typeof document === "undefined") {
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

type MarkdownTableData = {
  headers: string[];
  rows: string[][];
};

function extractTableData(table: HTMLTableElement): MarkdownTableData {
  const headers = Array.from(table.querySelectorAll("thead th")).map((cell) =>
    (cell.textContent ?? "").trim(),
  );
  const rows = Array.from(table.querySelectorAll("tbody tr")).map((row) =>
    Array.from(row.querySelectorAll("td")).map((cell) => (cell.textContent ?? "").trim()),
  );
  return { headers, rows };
}

function toDelimitedTable(data: MarkdownTableData, delimiter: "," | "\t"): string {
  const escapeCell = (value: string): string => {
    const needsQuotes = value.includes(delimiter) || value.includes('"') || value.includes("\n");
    const escaped = value.replace(/"/g, '""');
    return needsQuotes ? `"${escaped}"` : escaped;
  };

  const lines: string[] = [];
  if (data.headers.length > 0) {
    lines.push(data.headers.map(escapeCell).join(delimiter));
  }
  for (const row of data.rows) {
    lines.push(row.map(escapeCell).join(delimiter));
  }
  return lines.join("\n");
}

function toMarkdownTable(data: MarkdownTableData): string {
  if (data.headers.length === 0) {
    return data.rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
  }

  const separator = `| ${data.headers.map(() => "---").join(" | ")} |`;
  const body = data.rows.map((row) => `| ${row.join(" | ")} |`);
  return [`| ${data.headers.join(" | ")} |`, separator, ...body].join("\n");
}

function triggerBlobDownload(content: string, fileName: string, mimeType: string) {
  if (typeof document === "undefined") {
    return;
  }
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, fileName);
  URL.revokeObjectURL(url);
}

const MarkdownImage = defineComponent({
  name: "CopilotMarkdownImage",
  inheritAttrs: false,
  props: {
    src: {
      type: String,
      default: "",
    },
    alt: {
      type: String,
      default: "",
    },
  },
  setup(imageProps, { attrs }) {
    async function handleDownload() {
      if (!imageProps.src) {
        return;
      }

      const fileName = extractFileNameFromUrl(imageProps.src, "image");
      try {
        const response = await fetch(imageProps.src);
        if (!response.ok) {
          throw new Error("Failed to fetch image");
        }
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        triggerDownload(objectUrl, fileName);
        URL.revokeObjectURL(objectUrl);
      } catch {
        triggerDownload(imageProps.src, fileName);
      }
    }

    return () => {
      const imageAttrs = {
        ...attrs,
        src: imageProps.src,
        alt: imageProps.alt,
        class: ["max-w-full rounded-lg", attrs.class].filter(Boolean).join(" "),
        "data-streamdown": "image",
      } as Record<string, unknown>;

      delete imageAttrs.className;

      return h("div", { class: "group relative my-4 inline-block", "data-streamdown": "image-wrapper" }, [
        h("img", imageAttrs),
        h("div", {
          class: "pointer-events-none absolute inset-0 hidden rounded-lg bg-black/10 group-hover:block",
        }),
        h(
          "button",
          {
            type: "button",
            class:
              "absolute right-2 bottom-2 flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-border bg-background/90 shadow-sm backdrop-blur-sm transition-all duration-200 hover:bg-background opacity-0 group-hover:opacity-100",
            title: "Download image",
            onClick: handleDownload,
          },
          [h(IconDownload, { class: "size-[14px]" })],
        ),
      ]);
    };
  },
});

const tableIconButtonClass =
  "cursor-pointer p-1 text-muted-foreground transition-all hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50";
const tableMenuClass =
  "absolute top-full right-0 z-10 mt-1 min-w-[120px] overflow-hidden rounded-md border border-border bg-background shadow-lg";
const tableMenuItemClass = "w-full px-3 py-2 text-left text-sm transition-colors hover:bg-muted/40";

const MarkdownTable = defineComponent({
  name: "CopilotMarkdownTable",
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    const wrapperRef = ref<HTMLElement | null>(null);
    const showCopyMenu = ref(false);
    const showDownloadMenu = ref(false);
    const copied = ref(false);
    let copiedResetTimeout: ReturnType<typeof setTimeout> | null = null;

    const closeMenus = () => {
      showCopyMenu.value = false;
      showDownloadMenu.value = false;
    };

    const resetCopiedStateWithDelay = () => {
      if (copiedResetTimeout) {
        clearTimeout(copiedResetTimeout);
      }
      copied.value = true;
      copiedResetTimeout = setTimeout(() => {
        copied.value = false;
        copiedResetTimeout = null;
      }, 2000);
    };

    const findTable = (): HTMLTableElement | null => {
      if (!wrapperRef.value) return null;
      return wrapperRef.value.querySelector("table");
    };

    const getTableData = (): MarkdownTableData | null => {
      const table = findTable();
      if (!table) return null;
      return extractTableData(table);
    };

    const copyTableAs = async (format: "csv" | "tsv") => {
      const data = getTableData();
      if (!data) return;

      const delimiter = format === "csv" ? "," : "\t";
      const text = toDelimitedTable(data, delimiter);

      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          return;
        }
      }

      closeMenus();
      resetCopiedStateWithDelay();
    };

    const downloadTableAs = (format: "csv" | "markdown") => {
      const data = getTableData();
      if (!data) return;

      if (format === "csv") {
        triggerBlobDownload(toDelimitedTable(data, ","), "table.csv", "text/csv");
      } else {
        triggerBlobDownload(toMarkdownTable(data), "table.md", "text/markdown");
      }

      closeMenus();
    };

    const handleClickOutside = (event: MouseEvent) => {
      if (!wrapperRef.value) return;
      const target = event.target as Node | null;
      if (target && !wrapperRef.value.contains(target)) {
        closeMenus();
      }
    };

    onMounted(() => {
      if (typeof document !== "undefined") {
        document.addEventListener("mousedown", handleClickOutside);
      }
    });

    onBeforeUnmount(() => {
      if (copiedResetTimeout) {
        clearTimeout(copiedResetTimeout);
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("mousedown", handleClickOutside);
      }
    });

    return () => {
      const tableAttrs = {
        ...attrs,
        class: ["w-full border-collapse border border-border", attrs.class].filter(Boolean).join(" "),
        "data-streamdown": "table",
      } as Record<string, unknown>;

      delete tableAttrs.className;

      return h("div", { ref: wrapperRef, class: "my-4 flex flex-col space-y-2", "data-streamdown": "table-wrapper" }, [
        h("div", { class: "flex items-center justify-end gap-1" }, [
          h("div", { class: "relative" }, [
            h(
              "button",
              {
                type: "button",
                class: tableIconButtonClass,
                title: "Copy table",
                onClick: () => {
                  showCopyMenu.value = !showCopyMenu.value;
                  showDownloadMenu.value = false;
                },
              },
              [copied.value ? h(IconCheck, { class: "size-[14px]" }) : h(IconCopy, { class: "size-[14px]" })],
            ),
            showCopyMenu.value
              ? h("div", { class: tableMenuClass }, [
                  h(
                    "button",
                    {
                      type: "button",
                      class: tableMenuItemClass,
                      title: "Copy table as CSV",
                      onClick: () => copyTableAs("csv"),
                    },
                    "CSV",
                  ),
                  h(
                    "button",
                    {
                      type: "button",
                      class: tableMenuItemClass,
                      title: "Copy table as TSV",
                      onClick: () => copyTableAs("tsv"),
                    },
                    "TSV",
                  ),
                ])
              : null,
          ]),
          h("div", { class: "relative" }, [
            h(
              "button",
              {
                type: "button",
                class: tableIconButtonClass,
                title: "Download table",
                onClick: () => {
                  showDownloadMenu.value = !showDownloadMenu.value;
                  showCopyMenu.value = false;
                },
              },
              [h(IconDownload, { class: "size-[14px]" })],
            ),
            showDownloadMenu.value
              ? h("div", { class: tableMenuClass }, [
                  h(
                    "button",
                    {
                      type: "button",
                      class: tableMenuItemClass,
                      title: "Download table as CSV",
                      onClick: () => downloadTableAs("csv"),
                    },
                    "CSV",
                  ),
                  h(
                    "button",
                    {
                      type: "button",
                      class: tableMenuItemClass,
                      title: "Download table as Markdown",
                      onClick: () => downloadTableAs("markdown"),
                    },
                    "Markdown",
                  ),
                ])
              : null,
          ]),
        ]),
        h("div", { class: "overflow-x-auto" }, [h("table", tableAttrs, slots.default ? slots.default() : [])]),
      ]);
    };
  },
});

const codeActionButtonClass =
  "cursor-pointer p-1 text-muted-foreground transition-all hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50";

const codeLanguageExtensionMap: Record<string, string> = {
  javascript: "js",
  js: "js",
  typescript: "ts",
  ts: "ts",
  json: "json",
  vue: "vue",
  html: "html",
  css: "css",
  md: "md",
  markdown: "md",
  sh: "sh",
  bash: "sh",
  py: "py",
  python: "py",
  go: "go",
  rust: "rs",
  rs: "rs",
};

const CodeBlockCopyAction = defineComponent({
  name: "CopilotCodeBlockCopyAction",
  props: {
    code: {
      type: String,
      default: "",
    },
  },
  setup(actionProps) {
    const copied = ref(false);
    let resetTimeout: ReturnType<typeof setTimeout> | null = null;

    const handleClick = async () => {
      if (!actionProps.code) return;
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(actionProps.code);
        } catch {
          return;
        }
      }

      if (resetTimeout) {
        clearTimeout(resetTimeout);
      }
      copied.value = true;
      resetTimeout = setTimeout(() => {
        copied.value = false;
        resetTimeout = null;
      }, 2000);
    };

    onBeforeUnmount(() => {
      if (resetTimeout) {
        clearTimeout(resetTimeout);
      }
    });

    return () =>
      h(
        "button",
        {
          type: "button",
          class: codeActionButtonClass,
          title: "Copy Code",
          "data-streamdown": "code-block-copy-button",
          onClick: handleClick,
        },
        [copied.value ? h(IconCheck, { class: "size-[14px]" }) : h(IconCopy, { class: "size-[14px]" })],
      );
  },
});

const CodeBlockDownloadAction = defineComponent({
  name: "CopilotCodeBlockDownloadAction",
  props: {
    code: {
      type: String,
      default: "",
    },
    language: {
      type: String,
      default: "",
    },
  },
  setup(actionProps) {
    const handleClick = () => {
      if (!actionProps.code) return;
      const extension = codeLanguageExtensionMap[actionProps.language.toLowerCase()] ?? "txt";
      triggerBlobDownload(actionProps.code, `file.${extension}`, "text/plain");
    };

    return () =>
      h(
        "button",
        {
          type: "button",
          class: codeActionButtonClass,
          title: "Download file",
          "data-streamdown": "code-block-download-button",
          onClick: handleClick,
        },
        [h(IconDownload, { class: "size-[14px]" })],
      );
  },
});

const markdownComponents = {
  img: MarkdownImage,
  table: MarkdownTable,
};

function normalizeContent(content: unknown): string {
  if (!content) {
    return "";
  }

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const parts = content as Array<{ type?: unknown; text?: unknown }>;
    return parts
      .map((part) => {
        if (
          part &&
          typeof part === "object" &&
          "type" in part &&
          part.type === "text" &&
          typeof part.text === "string"
        ) {
          return part.text;
        }
        return "";
      })
      .filter((text) => text.length > 0)
      .join("\n");
  }

  return "";
}

const normalizedContent = computed(() => normalizeContent(props.message.content));
const hasContent = computed(() => normalizedContent.value.trim().length > 0);
function hasListener(listenerName: string) {
  const listener = vnodeProps.value[listenerName];
  if (Array.isArray(listener)) {
    return listener.length > 0;
  }
  return !!listener;
}

const hasThumbsUp = computed(() => hasListener("onThumbsUp"));
const hasThumbsDown = computed(() => hasListener("onThumbsDown"));
const hasReadAloud = computed(() => hasListener("onReadAloud"));
const hasRegenerate = computed(() => hasListener("onRegenerate"));
const isLatestAssistantMessage = computed(
  () => props.messages[props.messages.length - 1]?.id === props.message.id,
);
const shouldShowToolbar = computed(
  () => props.toolbarVisible && hasContent.value && !(props.isRunning && isLatestAssistantMessage.value),
);

function resetCopiedStateWithDelay() {
  if (copiedResetTimeout) {
    clearTimeout(copiedResetTimeout);
  }
  copied.value = true;
  copiedResetTimeout = setTimeout(() => {
    copied.value = false;
    copiedResetTimeout = null;
  }, 2000);
}

async function handleCopyMessage() {
  const content = normalizedContent.value;
  if (!content) return;

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(content);
      resetCopiedStateWithDelay();
    } catch {
      resetCopiedStateWithDelay();
    }
  } else {
    resetCopiedStateWithDelay();
  }
}

function handleThumbsUp() {
  emit("thumbs-up", props.message);
}

function handleThumbsDown() {
  emit("thumbs-down", props.message);
}

function handleReadAloud() {
  emit("read-aloud", props.message);
}

function handleRegenerate() {
  emit("regenerate", props.message);
}

onBeforeUnmount(() => {
  if (copiedResetTimeout) {
    clearTimeout(copiedResetTimeout);
  }
});
</script>

<template>
  <div
    class="prose max-w-full break-words dark:prose-invert"
    :data-message-id="message.id"
    v-bind="$attrs"
  >
    <slot
      name="message-renderer"
      :message="message"
      :content="normalizedContent"
    >
      <StreamMarkdown
        v-if="hasContent"
        class="copilot-chat-assistant-markdown"
        :content="normalizedContent"
        :components="markdownComponents"
        :code-block-actions="[CodeBlockDownloadAction, CodeBlockCopyAction]"
        :code-block-show-line-numbers="false"
        :code-block-hide-copy="true"
        :code-block-hide-download="true"
        :allowed-link-prefixes="['https://', 'http://', '#', '/', './', '../']"
        :shiki-theme="{ light: 'github-light', dark: 'github-dark' }"
      />
    </slot>

    <slot name="tool-calls-view" :message="message" :messages="messages">
      <CopilotChatToolCallsView :message="message" :messages="messages">
        <template v-for="(_, slotName) in $slots" :key="slotName" #[slotName]="slotProps">
          <slot :name="slotName" v-bind="slotProps" />
        </template>
      </CopilotChatToolCallsView>
    </slot>

    <slot
      v-if="shouldShowToolbar"
      name="toolbar"
      :message="message"
      :should-show-toolbar="shouldShowToolbar"
    >
      <div class="w-full bg-transparent flex items-center -ml-[5px] -mt-[0px]">
        <div class="flex items-center gap-1">
          <slot
            name="copy-button"
            :on-copy="handleCopyMessage"
            :copied="copied"
            :label="labels.assistantMessageToolbarCopyMessageLabel"
          >
            <button
              type="button"
              :class="toolbarButtonClass"
              :aria-label="labels.assistantMessageToolbarCopyMessageLabel"
              :title="labels.assistantMessageToolbarCopyMessageLabel"
              @click="handleCopyMessage"
            >
              <IconCheck v-if="copied" class="size-[18px]" />
              <IconCopy v-else class="size-[18px]" />
            </button>
          </slot>

          <slot
            v-if="hasThumbsUp"
            name="thumbs-up-button"
            :on-thumbs-up="handleThumbsUp"
            :label="labels.assistantMessageToolbarThumbsUpLabel"
          >
            <button
              type="button"
              :class="toolbarButtonClass"
              :aria-label="labels.assistantMessageToolbarThumbsUpLabel"
              :title="labels.assistantMessageToolbarThumbsUpLabel"
              @click="handleThumbsUp"
            >
              <IconThumbsUp class="size-[18px]" />
            </button>
          </slot>

          <slot
            v-if="hasThumbsDown"
            name="thumbs-down-button"
            :on-thumbs-down="handleThumbsDown"
            :label="labels.assistantMessageToolbarThumbsDownLabel"
          >
            <button
              type="button"
              :class="toolbarButtonClass"
              :aria-label="labels.assistantMessageToolbarThumbsDownLabel"
              :title="labels.assistantMessageToolbarThumbsDownLabel"
              @click="handleThumbsDown"
            >
              <IconThumbsDown class="size-[18px]" />
            </button>
          </slot>

          <slot
            v-if="hasReadAloud"
            name="read-aloud-button"
            :on-read-aloud="handleReadAloud"
            :label="labels.assistantMessageToolbarReadAloudLabel"
          >
            <button
              type="button"
              :class="toolbarButtonClass"
              :aria-label="labels.assistantMessageToolbarReadAloudLabel"
              :title="labels.assistantMessageToolbarReadAloudLabel"
              @click="handleReadAloud"
            >
              <IconVolume2 class="size-[20px]" />
            </button>
          </slot>

          <slot
            v-if="hasRegenerate"
            name="regenerate-button"
            :on-regenerate="handleRegenerate"
            :label="labels.assistantMessageToolbarRegenerateLabel"
          >
            <button
              type="button"
              :class="toolbarButtonClass"
              :aria-label="labels.assistantMessageToolbarRegenerateLabel"
              :title="labels.assistantMessageToolbarRegenerateLabel"
              @click="handleRegenerate"
            >
              <IconRefreshCw class="size-[18px]" />
            </button>
          </slot>

          <slot name="toolbar-items" />
        </div>
      </div>
    </slot>
  </div>
</template>
