"use client";

import {
  CopilotKitProvider,
  CopilotChat,
  useComponent,
} from "@copilotkit/react-core/v2";

export default function GenUiToolBased() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint>
      <Demo />
    </CopilotKitProvider>
  );
}

function Demo() {
  useComponent({
    name: "generate_haiku",
    render: HaikuCard,
  });

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold mb-4">Tool-Based Generative UI</h1>
      <p className="text-sm opacity-70 mb-6">
        Try: &ldquo;Write me a haiku about nature.&rdquo; The agent calls the
        <code className="mx-1 px-1 bg-gray-100 rounded">generate_haiku</code>
        tool and the result renders inline as a typed card.
      </p>
      <CopilotChat />
    </main>
  );
}

/**
 * HaikuCard — rendered by `useComponent({ name: "generate_haiku" })`.
 *
 * `useComponent` passes tool-call arguments directly as React props (via
 * `useFrontendTool`'s `render: ({ args }) => <Component {...args} />`).
 * The D5 fixture sends: { japanese, english, image_name, gradient }.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function HaikuCard(props: any) {
  const japaneseLines: string[] = props.japanese ?? [];
  const englishLines: string[] = props.english ?? props.lines ?? [];
  const gradient: string | undefined = props.gradient;
  const topic: string | undefined = props.topic;

  const hasContent = japaneseLines.length > 0 || englishLines.length > 0;

  if (!hasContent) {
    return (
      <div
        data-testid="haiku-card"
        className="border rounded p-3 my-2 opacity-70 text-sm"
      >
        Composing haiku{topic ? ` about ${topic}` : ""}…
      </div>
    );
  }

  return (
    <div
      data-testid="haiku-card"
      className="border rounded p-4 my-2 bg-amber-50"
      style={gradient ? { background: gradient } : undefined}
    >
      <div className="font-medium mb-2">Haiku{topic ? ` — ${topic}` : ""}</div>
      {japaneseLines.length > 0 && (
        <div className="mb-2">
          {japaneseLines.map((line: string, i: number) => (
            <div
              key={i}
              data-testid="haiku-japanese-line"
              className="text-lg leading-relaxed"
            >
              {line}
            </div>
          ))}
        </div>
      )}
      <div className="font-serif italic whitespace-pre-line text-lg leading-relaxed">
        {englishLines.map((line: string, i: number) => (
          <div key={i} data-testid="haiku-english-line">
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
