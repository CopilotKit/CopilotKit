export type MarkdownBlock = {
  id: string;
  type: "markdown";
  content: string;
};

export type ChartBlock = {
  id: string;
  type: "chart";
  title: string;
  chartType: "bar" | "line" | "pie";
  labels: string[];
  values: number[];
};

export type TableBlock = {
  id: string;
  type: "table";
  title: string;
  headers: string[];
  rows: string[][];
};

export type CodeBlock = {
  id: string;
  type: "code";
  language: string;
  code: string;
  filename?: string;
};

export type ContentBlock = MarkdownBlock | ChartBlock | TableBlock | CodeBlock;
