// Uses @copilotkit/markdown-renderer (derived from hashbrown Magic Text, MIT, © LiveLoveApp, LLC).
import { computed, defineComponent, h } from 'vue';
import type { PropType, VNode } from 'vue';
import {
  createStreamingMarkdownParserState,
  finalizeStreamingMarkdown,
  parseStreamingMarkdownChunk,
} from '@copilotkit/markdown-renderer';
import type {
  StreamingMarkdownAstNode,
  StreamingMarkdownParserOptions,
  StreamingMarkdownParserState,
  TextSegment,
} from '@copilotkit/markdown-renderer';

// ---------------------------------------------------------------------------
// URL sanitization (mirrors BasicMarkdown.vue allowlists)
// ---------------------------------------------------------------------------

const SAFE_HREF = /^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i;
const SAFE_IMG_SRC = /^(https?:|data:image\/(?!svg)|\/|\.\/|\.\.\/)/i;

function sanitizeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  return SAFE_HREF.test(href.trim()) ? href : undefined;
}

function sanitizeImgSrc(src: string | undefined): string | undefined {
  if (!src) return undefined;
  return SAFE_IMG_SRC.test(src.trim()) ? src : undefined;
}

// ---------------------------------------------------------------------------
// Parser helpers (full re-parse approach — simple and correct)
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS: StreamingMarkdownParserOptions = {
  segmenter: true,
  enableTables: true,
  enableAutolinks: true,
};

function normalizeOptions(
  options?: Partial<StreamingMarkdownParserOptions>,
): StreamingMarkdownParserOptions {
  return {
    segmenter: options?.segmenter ?? DEFAULT_OPTIONS.segmenter,
    enableTables: options?.enableTables ?? DEFAULT_OPTIONS.enableTables,
    enableAutolinks: options?.enableAutolinks ?? DEFAULT_OPTIONS.enableAutolinks,
  };
}

function buildParserState(
  content: string,
  options: StreamingMarkdownParserOptions,
  isComplete: boolean,
): StreamingMarkdownParserState {
  const state = createStreamingMarkdownParserState(options);
  const parsed = content.length > 0 ? parseStreamingMarkdownChunk(state, content) : state;
  return isComplete ? finalizeStreamingMarkdown(parsed) : parsed;
}

// ---------------------------------------------------------------------------
// AST → VNode walker
// ---------------------------------------------------------------------------

type NodeById = Map<number, StreamingMarkdownAstNode>;

type TextNode = Extract<StreamingMarkdownAstNode, { type: 'text' }>;

function renderTextSegments(node: TextNode): (VNode | string)[] {
  if (node.text.length === 0) return [];
  if (node.segments.length === 0) {
    return [
      h('span', { class: 'hb-streaming-markdown-segment' }, node.text),
    ];
  }
  return node.segments.map((segment: TextSegment) =>
    h(
      'span',
      {
        class: 'hb-streaming-markdown-segment',
        'data-streaming-markdown-segment-kind': segment.kind,
        'data-streaming-markdown-whitespace': String(segment.isWhitespace),
      },
      segment.noBreakBefore ? `⁠${segment.text}` : segment.text,
    ),
  );
}

function renderChildren(childIds: number[], nodeById: NodeById): (VNode | string | null)[] {
  return childIds.map((id) => {
    const child = nodeById.get(id);
    return child ? renderNode(child, nodeById) : null;
  });
}

function renderNode(node: StreamingMarkdownAstNode, nodeById: NodeById): VNode | string | null {
  switch (node.type) {
    case 'document': {
      // Document is transparent — render children directly as a Fragment via array
      // We wrap in a div for the root element, handled at the top level.
      // Here just return children inlined (will be wrapped by root div).
      return h('span', { style: 'display:contents' }, renderChildren(node.children, nodeById));
    }

    case 'paragraph': {
      return h(
        'p',
        {
          'data-streaming-markdown-node': 'paragraph',
          'data-node-open': String(!node.closed),
        },
        renderChildren(node.children, nodeById),
      );
    }

    case 'heading': {
      const tag = `h${node.level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      return h(
        tag,
        {
          'data-streaming-markdown-node': 'heading',
          'data-node-open': String(!node.closed),
        },
        renderChildren(node.children, nodeById),
      );
    }

    case 'blockquote': {
      return h(
        'blockquote',
        {
          'data-streaming-markdown-node': 'blockquote',
          'data-node-open': String(!node.closed),
        },
        renderChildren(node.children, nodeById),
      );
    }

    case 'list': {
      const tag = node.ordered ? 'ol' : 'ul';
      const attrs: Record<string, unknown> = {
        'data-streaming-markdown-node': 'list',
        'data-node-open': String(!node.closed),
        'data-list-tight': String(node.tight),
      };
      if (node.ordered && node.start != null) {
        attrs.start = node.start;
      }
      return h(tag, attrs, renderChildren(node.children, nodeById));
    }

    case 'list-item': {
      return h(
        'li',
        {
          'data-streaming-markdown-node': 'list-item',
          'data-node-open': String(!node.closed),
        },
        renderChildren(node.children, nodeById),
      );
    }

    case 'code-block': {
      return h(
        'pre',
        {
          'data-streaming-markdown-node': 'code-block',
          'data-node-open': String(!node.closed),
        },
        [h('code', { 'data-code-info': node.info ?? undefined }, node.text)],
      );
    }

    case 'table': {
      return h(
        'table',
        {
          'data-streaming-markdown-node': 'table',
          'data-node-open': String(!node.closed),
        },
        [h('tbody', renderChildren(node.children, nodeById))],
      );
    }

    case 'table-row': {
      return h(
        'tr',
        {
          'data-streaming-markdown-node': 'table-row',
          'data-node-open': String(!node.closed),
        },
        renderChildren(node.children, nodeById),
      );
    }

    case 'table-cell': {
      const parent = node.parentId != null ? nodeById.get(node.parentId) : undefined;
      const isHeader = parent?.type === 'table-row' && parent.isHeader;
      const tag = isHeader ? 'th' : 'td';
      return h(
        tag,
        {
          'data-streaming-markdown-node': 'table-cell',
          'data-node-open': String(!node.closed),
        },
        renderChildren(node.children, nodeById),
      );
    }

    case 'thematic-break': {
      return h('hr', {
        'data-streaming-markdown-node': 'thematic-break',
        'data-node-open': String(!node.closed),
      });
    }

    case 'text': {
      return h('span', { style: 'display:contents' }, renderTextSegments(node));
    }

    case 'em': {
      return h(
        'em',
        {
          'data-streaming-markdown-node': 'em',
          'data-node-open': String(!node.closed),
        },
        renderChildren(node.children, nodeById),
      );
    }

    case 'strong': {
      return h(
        'strong',
        {
          'data-streaming-markdown-node': 'strong',
          'data-node-open': String(!node.closed),
        },
        renderChildren(node.children, nodeById),
      );
    }

    case 'strikethrough': {
      return h(
        'del',
        {
          'data-streaming-markdown-node': 'strikethrough',
          'data-node-open': String(!node.closed),
        },
        renderChildren(node.children, nodeById),
      );
    }

    case 'inline-code': {
      return h(
        'code',
        {
          'data-streaming-markdown-node': 'inline-code',
          'data-node-open': String(!node.closed),
        },
        node.text,
      );
    }

    case 'soft-break': {
      return '\n';
    }

    case 'hard-break': {
      return h('br', {
        'data-streaming-markdown-node': 'hard-break',
        'data-node-open': String(!node.closed),
      });
    }

    case 'link': {
      const safeHref = sanitizeHref(node.url);
      const attrs: Record<string, unknown> = {
        'data-streaming-markdown-node': 'link',
        'data-node-open': String(!node.closed),
        target: '_blank',
        rel: 'noopener noreferrer',
      };
      if (safeHref != null) {
        attrs.href = safeHref;
      }
      if (node.title) {
        attrs.title = node.title;
      }
      return h('a', attrs, renderChildren(node.children, nodeById));
    }

    case 'image': {
      const safeSrc = sanitizeImgSrc(node.url);
      const attrs: Record<string, unknown> = {
        'data-streaming-markdown-node': 'image',
        'data-node-open': String(!node.closed),
        alt: node.alt,
      };
      if (safeSrc != null) {
        attrs.src = safeSrc;
      }
      if (node.title) {
        attrs.title = node.title;
      }
      return h('img', attrs);
    }

    case 'autolink': {
      const safeHref = sanitizeHref(node.url);
      const attrs: Record<string, unknown> = {
        'data-streaming-markdown-node': 'autolink',
        'data-node-open': String(!node.closed),
        target: '_blank',
        rel: 'noopener noreferrer',
      };
      if (safeHref != null) {
        attrs.href = safeHref;
      }
      return h('a', attrs, node.text);
    }

    case 'citation': {
      // Render as a superscript with the citation reference
      return h(
        'sup',
        {
          'data-streaming-markdown-node': 'citation',
          'data-node-open': String(!node.closed),
          class: 'hb-streaming-markdown-citation',
        },
        [
          h(
            'span',
            { role: 'doc-noteref', class: 'hb-streaming-markdown-citation-label' },
            String(node.number ?? node.idRef),
          ),
        ],
      );
    }

    default: {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Vue component props types (exported for consumer use)
// ---------------------------------------------------------------------------

/**
 * Custom Vue render function for a specific AST node.
 * @public
 */
export type VueStreamingMarkdownNodeRenderer = (
  node: StreamingMarkdownAstNode,
  defaultVNode: VNode | string | null,
) => VNode | string | null;

/**
 * Optional map of node-type renderer keys to custom Vue render functions.
 * @public
 */
export type VueStreamingMarkdownNodeRenderers = Partial<
  Record<string, VueStreamingMarkdownNodeRenderer>
>;

// ---------------------------------------------------------------------------
// StreamingMarkdownRenderer — Vue 3 Composition API component (.ts)
// ---------------------------------------------------------------------------

/**
 * Vue 3 streaming markdown renderer.
 *
 * Drives the `@copilotkit/markdown-renderer` zero-dep parser and walks the
 * resulting AST into VNodes via `h()`.
 *
 * @public
 */
export const StreamingMarkdownRenderer = defineComponent({
  name: 'StreamingMarkdownRenderer',

  props: {
    /** The full markdown source string, which may grow over time during streaming. */
    content: {
      type: String as PropType<string>,
      required: true,
    },
    /** When true, finalizes the parser state (end of stream). */
    isComplete: {
      type: Boolean as PropType<boolean>,
      default: false,
    },
    /** Optional parser option overrides. */
    options: {
      type: Object as PropType<Partial<StreamingMarkdownParserOptions>>,
      default: undefined,
    },
    /** Optional CSS class applied to the root wrapper element. */
    class: {
      type: String as PropType<string>,
      default: undefined,
    },
    /**
     * When true, renders a trailing cursor span after the last open node.
     * Animation niceties are left to CSS; this just inserts the element.
     */
    caret: {
      type: Boolean as PropType<boolean>,
      default: false,
    },
  },

  setup(props) {
    const parserState = computed<StreamingMarkdownParserState>(() => {
      const opts = normalizeOptions(props.options);
      return buildParserState(props.content ?? '', opts, props.isComplete);
    });

    const nodeById = computed<NodeById>(() => {
      const map = new Map<number, StreamingMarkdownAstNode>();
      for (const node of parserState.value.nodes) {
        map.set(node.id, node);
      }
      return map;
    });

    return () => {
      const state = parserState.value;
      const byId = nodeById.value;
      const rootNode = state.rootId != null ? byId.get(state.rootId) : undefined;

      const rootClass = props.class
        ? `hb-streaming-markdown-root ${props.class}`
        : 'hb-streaming-markdown-root';

      if (!rootNode) {
        return h('div', {
          class: rootClass,
          'data-streaming-markdown-root': true,
        });
      }

      // Render children of document directly (skip the transparent document wrapper)
      const children: (VNode | string | null)[] =
        rootNode.type === 'document'
          ? rootNode.children.map((id) => {
              const child = byId.get(id);
              return child ? renderNode(child, byId) : null;
            })
          : [renderNode(rootNode, byId)];

      // Append caret if requested and not complete
      if (props.caret && !state.isComplete) {
        children.push(
          h('span', {
            'aria-hidden': true,
            class: 'hb-streaming-markdown-caret',
            'data-streaming-markdown-caret': true,
            style: {
              display: 'inline-block',
              width: '0.48em',
              height: '0.48em',
              marginInlineStart: '0.08em',
              verticalAlign: '-0.08em',
              borderRadius: '999px',
              backgroundColor: 'currentColor',
              opacity: '0.55',
            },
          }),
        );
      }

      return h(
        'div',
        {
          class: rootClass,
          'data-streaming-markdown-root': true,
        },
        children,
      );
    };
  },
});
