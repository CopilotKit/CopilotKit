import {
  CopilotChat,
  CopilotChatAssistantMessage,
} from "@copilotkit/react-core";

export function Chat() {
  return (
    <CopilotChat
      messageView={{
        assistantMessage: {
          markdownRenderer: {
            className: "prose",
            /* TODO(copilotkit-2.0): `components` was a Streamdown prop. The built-in renderer uses `nodeRenderers`, keyed by node type (`link`, `heading`, `codeBlock`, ...) and not by HTML tag: https://docs.copilotkit.ai/migrate/markdown-renderer */ components: {
              a: ({ node, children, ...props }) => <a {...props}>{children}</a>,
            },
            /* TODO(copilotkit-2.0): `shikiTheme` was a Streamdown prop. The built-in renderer does not highlight code. To keep highlighting, set `nodeRenderers.codeBlock`, or pass your own renderer component as `markdownRenderer`: https://docs.copilotkit.ai/migrate/markdown-renderer */ shikiTheme: ["github-light", "github-dark"],
            /* TODO(copilotkit-2.0): `parseIncompleteMarkdown` was a Streamdown prop. Delete this prop. The built-in renderer always parses streaming markdown. */ parseIncompleteMarkdown: true,
          },
        },
      }}
    />
  );
}

export function Message(props: CopilotChatAssistantMessage.Props) {
  return (
    <CopilotChatAssistantMessage
      {...props}
      markdownRenderer={{ /* TODO(copilotkit-2.0): `isAnimating` was a Streamdown prop. Delete this prop. The chat passes `isStreaming` to the renderer. */ isAnimating: true, /* TODO(copilotkit-2.0): `controls` was a Streamdown prop. The built-in renderer has no copy or download buttons. Delete this prop, or pass your own renderer component as `markdownRenderer`: https://docs.copilotkit.ai/migrate/markdown-renderer */ controls: false }}
    />
  );
}

export function Markdown({ content }: { content: string }) {
  return (
    <CopilotChatAssistantMessage.MarkdownRenderer
      content={content}
      /* TODO(copilotkit-2.0): `remarkPlugins` was a Streamdown prop. The built-in renderer has no remark or rehype plugins. To keep them, pass a `react-markdown` component as `markdownRenderer`: https://docs.copilotkit.ai/migrate/markdown-renderer */ remarkPlugins={[]}
      className="text-sm"
    />
  );
}

// A class string still works, and other objects are not slot values.
const classOnly = { markdownRenderer: "text-sm leading-7" };
const unrelated = { components: {}, mode: "dark" };
