<script setup lang="ts">
import {
  computed,
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  ref,
} from "vue";
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
import { getAssistantTurn } from "./assistant-turn";
import { rehypeCursorAnchor } from "./streaming-cursor";
import type {
  CopilotChatAssistantMessageCopyButtonSlotProps,
  CopilotChatAssistantMessageLayoutSlotProps,
  CopilotChatAssistantMessageMessageRendererSlotProps,
  CopilotChatAssistantMessageReadAloudButtonSlotProps,
  CopilotChatAssistantMessageRegenerateButtonSlotProps,
  CopilotChatAssistantMessageThumbsDownButtonSlotProps,
  CopilotChatAssistantMessageThumbsUpButtonSlotProps,
  CopilotChatAssistantMessageToolCallsViewSlotProps,
  CopilotChatAssistantMessageToolbarSlotProps,
} from "./types";
import { useKatexStyles } from "../../hooks/use-katex-styles";

useKatexStyles();

const props = withDefaults(
  defineProps<{
    message: AssistantMessage;
    messages?: Message[];
    isRunning?: boolean;
    toolbarVisible?: boolean;
    onThumbsUp?: (message: AssistantMessage) => void;
    onThumbsDown?: (message: AssistantMessage) => void;
    onReadAloud?: (message: AssistantMessage) => void;
    onRegenerate?: (message: AssistantMessage) => void;
    /**
     * Where the toolbar (copy, feedback, regenerate…) appears.
     *
     * - `"turn"` (default): one toolbar per reply. When a single user message
     *   produces several assistant messages, only the last one shows the
     *   toolbar, and copy / read aloud cover the whole reply.
     * - `"message"`: every assistant message gets its own toolbar.
     *
     * Needs `messages` to find the reply; without it every message is its own turn.
     */
    toolbarScope?: "turn" | "message";
    /**
     * Shows a pulsing cursor at the end of the text while it's being written.
     * `CopilotChatMessageView` sets this on the reply that's streaming.
     */
    showCursor?: boolean;
  }>(),
  {
    messages: () => [],
    isRunning: false,
    toolbarVisible: true,
    toolbarScope: "turn",
    showCursor: false,
  },
);

defineSlots<{
  layout?: (props: CopilotChatAssistantMessageLayoutSlotProps) => unknown;
  "message-renderer"?: (
    props: CopilotChatAssistantMessageMessageRendererSlotProps,
  ) => unknown;
  toolbar?: (props: CopilotChatAssistantMessageToolbarSlotProps) => unknown;
  "copy-button"?: (
    props: CopilotChatAssistantMessageCopyButtonSlotProps,
  ) => unknown;
  "thumbs-up-button"?: (
    props: CopilotChatAssistantMessageThumbsUpButtonSlotProps,
  ) => unknown;
  "thumbs-down-button"?: (
    props: CopilotChatAssistantMessageThumbsDownButtonSlotProps,
  ) => unknown;
  "read-aloud-button"?: (
    props: CopilotChatAssistantMessageReadAloudButtonSlotProps,
  ) => unknown;
  "regenerate-button"?: (
    props: CopilotChatAssistantMessageRegenerateButtonSlotProps,
  ) => unknown;
  "tool-calls-view"?: (
    props: CopilotChatAssistantMessageToolCallsViewSlotProps,
  ) => unknown;
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
const copied = ref(false);
let copiedResetTimeout: ReturnType<typeof setTimeout> | null = null;

// 28×36, matching React's toolbar buttons.
const toolbarButtonClass = [
  "cpk:inline-flex cpk:h-9 cpk:w-7 cpk:items-center cpk:justify-center cpk:rounded-md cpk:p-0",
  "cpk:cursor-pointer cpk:text-muted-foreground cpk:transition-colors cpk:hover:bg-accent cpk:hover:text-foreground",
  "cpk:disabled:pointer-events-none cpk:disabled:opacity-50",
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
    Array.from(row.querySelectorAll("td")).map((cell) =>
      (cell.textContent ?? "").trim(),
    ),
  );
  return { headers, rows };
}

function toDelimitedTable(
  data: MarkdownTableData,
  delimiter: "," | "\t",
): string {
  const escapeCell = (value: string): string => {
    const needsQuotes =
      value.includes(delimiter) || value.includes('"') || value.includes("\n");
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

function triggerBlobDownload(
  content: string,
  fileName: string,
  mimeType: string,
) {
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
        "data-streamdown": "image",
      } as Record<string, unknown>;

      delete imageAttrs.className;

      return h(
        "div",
        { class: "cpk:group", "data-streamdown": "image-wrapper" },
        [
          h("img", imageAttrs),
          h(
            "button",
            {
              type: "button",
              class:
                "cpk:absolute cpk:right-2 cpk:bottom-2 cpk:flex cpk:size-7 cpk:cursor-pointer cpk:items-center cpk:justify-center cpk:rounded-md cpk:border cpk:border-border cpk:bg-background/90 cpk:text-foreground cpk:opacity-0 cpk:backdrop-blur-sm cpk:transition-opacity cpk:group-hover:opacity-100 cpk:focus-visible:opacity-100",
              title: "Download image",
              onClick: handleDownload,
            },
            [h(IconDownload, { class: "cpk:size-3.5" })],
          ),
        ],
      );
    };
  },
});

const tableIconButtonClass =
  "cpk:inline-flex cpk:size-[1.625rem] cpk:items-center cpk:justify-center cpk:rounded-sm cpk:cursor-pointer cpk:text-muted-foreground cpk:transition-colors cpk:hover:bg-accent cpk:hover:text-foreground cpk:disabled:cursor-not-allowed cpk:disabled:opacity-50";
const tableMenuClass =
  "cpk:absolute cpk:top-full cpk:right-0 cpk:z-10 cpk:mt-1 cpk:min-w-[120px] cpk:overflow-hidden cpk:rounded-lg cpk:border cpk:border-border cpk:bg-popover cpk:p-1 cpk:text-popover-foreground cpk:shadow-lg";
const tableMenuItemClass =
  "cpk:w-full cpk:rounded-sm cpk:px-2.5 cpk:py-1.5 cpk:text-left cpk:text-sm cpk:transition-colors cpk:hover:bg-accent";

const MarkdownTable = defineComponent({
  name: "CopilotMarkdownTable",
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    const wrapperRef = ref<HTMLElement | null>(null);
    const showCopyMenu = ref(false);
    const showDownloadMenu = ref(false);
    const tableCopied = ref(false);
    let tableCopiedResetTimeout: ReturnType<typeof setTimeout> | null = null;

    const closeMenus = () => {
      showCopyMenu.value = false;
      showDownloadMenu.value = false;
    };

    const setTableCopiedStateWithDelay = () => {
      if (tableCopiedResetTimeout) {
        clearTimeout(tableCopiedResetTimeout);
      }
      tableCopied.value = true;
      tableCopiedResetTimeout = setTimeout(() => {
        tableCopied.value = false;
        tableCopiedResetTimeout = null;
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
      setTableCopiedStateWithDelay();
    };

    const downloadTableAs = (format: "csv" | "markdown") => {
      const data = getTableData();
      if (!data) return;

      if (format === "csv") {
        triggerBlobDownload(
          toDelimitedTable(data, ","),
          "table.csv",
          "text/csv",
        );
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
      if (tableCopiedResetTimeout) {
        clearTimeout(tableCopiedResetTimeout);
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("mousedown", handleClickOutside);
      }
    });

    return () => {
      const tableAttrs = {
        ...attrs,
        "data-streamdown": "table",
      } as Record<string, unknown>;

      delete tableAttrs.className;

      return h("div", { ref: wrapperRef, "data-streamdown": "table-wrapper" }, [
        h(
          "div",
          { class: "cpk:flex cpk:items-center cpk:justify-end cpk:gap-0.5" },
          [
            h("div", { class: "cpk:relative" }, [
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
                [
                  tableCopied.value
                    ? h(IconCheck, { class: "cpk:size-3.5" })
                    : h(IconCopy, { class: "cpk:size-3.5" }),
                ],
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
            h("div", { class: "cpk:relative" }, [
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
                [h(IconDownload, { class: "cpk:size-3.5" })],
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
          ],
        ),
        h("div", [
          h("table", tableAttrs, slots.default ? slots.default() : []),
        ]),
      ]);
    };
  },
});

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
    const isCopied = ref(false);
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
      isCopied.value = true;
      resetTimeout = setTimeout(() => {
        isCopied.value = false;
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
          title: "Copy Code",
          "data-streamdown": "code-block-copy-button",
          onClick: handleClick,
        },
        [
          isCopied.value
            ? h(IconCheck, { class: "cpk:size-3.5" })
            : h(IconCopy, { class: "cpk:size-3.5" }),
        ],
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
      const extension =
        codeLanguageExtensionMap[actionProps.language.toLowerCase()] ?? "txt";
      triggerBlobDownload(actionProps.code, `file.${extension}`, "text/plain");
    };

    return () =>
      h(
        "button",
        {
          type: "button",
          title: "Download file",
          "data-streamdown": "code-block-download-button",
          onClick: handleClick,
        },
        [h(IconDownload, { class: "cpk:size-3.5" })],
      );
  },
});

// Marks where the streaming cursor rides (see streaming-cursor.ts).
const rehypePlugins = [rehypeCursorAnchor];

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

const normalizedContent = computed(() =>
  normalizeContent(props.message.content),
);
const turn = computed(() =>
  props.toolbarScope === "turn" && props.messages.length > 0
    ? getAssistantTurn(props.messages, props.message.id)
    : undefined,
);
// What copy / read aloud act on: the whole reply in turn scope.
const replyContent = computed(() =>
  turn.value ? turn.value.content : normalizedContent.value,
);
// Don't show the toolbar if the reply has no text (only tool calls).
const hasContent = computed(() => normalizedContent.value.trim().length > 0);
const hasReplyContent = computed(() => replyContent.value.trim().length > 0);
const hasThumbsUp = computed(() => typeof props.onThumbsUp === "function");
const hasThumbsDown = computed(() => typeof props.onThumbsDown === "function");
const hasReadAloud = computed(() => typeof props.onReadAloud === "function");
const hasRegenerate = computed(() => typeof props.onRegenerate === "function");
const isLatestAssistantMessage = computed(
  () => props.messages[props.messages.length - 1]?.id === props.message.id,
);
// In turn scope only the reply's last message carries the toolbar, and it
// stays hidden while that reply is still being produced.
const ownsToolbar = computed(
  () => !turn.value || turn.value.lastMessageId === props.message.id,
);
const isReplyInProgress = computed(() =>
  turn.value ? turn.value.isLatest : isLatestAssistantMessage.value,
);
const shouldShowToolbar = computed(
  () =>
    props.toolbarVisible &&
    ownsToolbar.value &&
    hasReplyContent.value &&
    !(props.isRunning && isReplyInProgress.value),
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
  const content = replyContent.value;
  if (!content) return;

  if (
    typeof navigator === "undefined" ||
    typeof navigator.clipboard?.writeText !== "function"
  ) {
    return;
  }

  try {
    await navigator.clipboard.writeText(content);
    resetCopiedStateWithDelay();
  } catch (error) {
    console.error("Failed to copy to clipboard:", error);
  }
}

function handleThumbsUp() {
  emit("thumbs-up", props.message);
}

function handleThumbsDown() {
  emit("thumbs-down", props.message);
}

function handleReadAloud() {
  emit("read-aloud", { ...props.message, content: replyContent.value });
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
  <slot
    name="layout"
    :message="message"
    :content="normalizedContent"
    :is-running="isRunning"
    :toolbar-visible="toolbarVisible"
    :should-show-toolbar="shouldShowToolbar"
    :message-renderer="$slots['message-renderer'] ?? (() => null)"
    :toolbar="$slots['toolbar'] ?? (() => null)"
    :copy-button="$slots['copy-button'] ?? (() => null)"
    :thumbs-up-button="$slots['thumbs-up-button'] ?? (() => null)"
    :thumbs-down-button="$slots['thumbs-down-button'] ?? (() => null)"
    :read-aloud-button="$slots['read-aloud-button'] ?? (() => null)"
    :regenerate-button="$slots['regenerate-button'] ?? (() => null)"
    :tool-calls-view="$slots['tool-calls-view'] ?? (() => null)"
    :on-copy="handleCopyMessage"
    :on-thumbs-up="handleThumbsUp"
    :on-thumbs-down="handleThumbsDown"
    :on-read-aloud="handleReadAloud"
    :on-regenerate="handleRegenerate"
  >
    <div
      data-copilotkit
      data-testid="copilot-assistant-message"
      class="cpk:prose cpk:max-w-full cpk:break-words cpk:text-foreground cpk:dark:prose-invert"
      :data-message-id="message.id"
      v-bind="$attrs"
    >
      <div :data-streaming-cursor="showCursor ? '' : undefined">
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
            :rehype-plugins="rehypePlugins"
            :code-block-actions="[CodeBlockDownloadAction, CodeBlockCopyAction]"
            :code-block-show-line-numbers="false"
            :code-block-hide-copy="true"
            :code-block-hide-download="true"
            :allowed-link-prefixes="[
              'https://',
              'http://',
              '#',
              '/',
              './',
              '../',
            ]"
            :shiki-theme="{ light: 'github-light', dark: 'github-dark' }"
          />
        </slot>
      </div>

      <slot name="tool-calls-view" :message="message" :messages="messages">
        <CopilotChatToolCallsView :message="message" :messages="messages">
          <template
            v-for="(_, slotName) in $slots"
            :key="slotName"
            #[slotName]="slotProps"
          >
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
        <div
          data-testid="copilot-assistant-toolbar"
          class="cpk:w-full cpk:bg-transparent cpk:flex cpk:items-center cpk:-ml-1 cpk:mt-2"
        >
          <div class="cpk:flex cpk:items-center cpk:gap-0.5">
            <slot
              name="copy-button"
              :on-copy="handleCopyMessage"
              :copied="copied"
              :label="labels.assistantMessageToolbarCopyMessageLabel"
            >
              <button
                data-testid="copilot-copy-button"
                type="button"
                :class="toolbarButtonClass"
                :aria-label="labels.assistantMessageToolbarCopyMessageLabel"
                :title="labels.assistantMessageToolbarCopyMessageLabel"
                @click="handleCopyMessage"
              >
                <IconCheck v-if="copied" class="cpk:size-4" />
                <IconCopy v-else class="cpk:size-4" />
              </button>
            </slot>

            <slot
              v-if="hasThumbsUp || $slots['thumbs-up-button']"
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
                <IconThumbsUp class="cpk:size-4" />
              </button>
            </slot>

            <slot
              v-if="hasThumbsDown || $slots['thumbs-down-button']"
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
                <IconThumbsDown class="cpk:size-4" />
              </button>
            </slot>

            <slot
              v-if="hasReadAloud || $slots['read-aloud-button']"
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
                <IconVolume2 class="cpk:size-4" />
              </button>
            </slot>

            <slot
              v-if="hasRegenerate || $slots['regenerate-button']"
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
                <IconRefreshCw class="cpk:size-4" />
              </button>
            </slot>

            <slot name="toolbar-items" />
          </div>
        </div>
      </slot>
    </div>
  </slot>
</template>
