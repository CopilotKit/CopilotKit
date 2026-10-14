/** Live model request; emitted content, identities and tool output are never fixtures. */
export function scenarios() {
  return [
    {
      id: "text-query-data",
      mode: "rich",
      categories: ["user-text", "assistant-text", "ordinary-tool"],
      steps: [
        {
          kind: "send",
          prompt:
            "Use query_data to fetch revenue by category. After receiving the result, summarize the revenue figures in a short plain-text reply. Do not create a chart, dashboard, image, or other UI. Do not use additional tools.",
        },
      ],
    },
  ];
}
