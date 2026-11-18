import {
  CopilotChat,
  CopilotChatAssistantMessage,
} from "@copilotkit/react-core/v2";

export function Chat() {
  return (
    <CopilotChat
      messageView={{
        assistantMessage: {
          markdownRenderer: {
            className: "prose",
            components: {
              a: ({ node, children, ...props }) => <a {...props}>{children}</a>,
            },
            shikiTheme: ["github-light", "github-dark"],
            parseIncompleteMarkdown: true,
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
      markdownRenderer={{ isAnimating: true, controls: false }}
    />
  );
}

export function Markdown({ content }: { content: string }) {
  return (
    <CopilotChatAssistantMessage.MarkdownRenderer
      content={content}
      remarkPlugins={[]}
      className="text-sm"
    />
  );
}

// A class string still works, and other objects are not slot values.
const classOnly = { markdownRenderer: "text-sm leading-7" };
const unrelated = { components: {}, mode: "dark" };
