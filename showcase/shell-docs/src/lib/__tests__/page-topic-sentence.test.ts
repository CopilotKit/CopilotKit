import { describe, expect, it } from "vitest";
import { pageTopicSentence } from "@/lib/page-topic-sentence";

const MASTRA = { slug: "mastra", name: "Mastra" };
const SPRING_AI = { slug: "spring-ai", name: "Spring AI" };
const REACT = { id: "react", name: "React" };
const VUE = { id: "vue", name: "Vue" };
const SLACK = { id: "slack", name: "Slack" };

describe("pageTopicSentence", () => {
  it("names the framework and the frontend", () => {
    expect(pageTopicSentence(MASTRA, VUE)).toBe(
      " The page covers the Mastra agent framework with Vue.",
    );
  });

  it("names the Next.js setup for the docs' React frontend", () => {
    expect(pageTopicSentence(MASTRA, REACT)).toBe(
      " The page covers the Mastra agent framework with Next.js.",
    );
  });

  it("reads as English for the Built-in agent", () => {
    expect(
      pageTopicSentence({ slug: "built-in-agent", name: "Built-in" }, REACT),
    ).toBe(" The page covers the Built-in agent framework with Next.js.");
  });

  it("names the framework alone when the frontend has no graph node", () => {
    expect(pageTopicSentence(MASTRA, SLACK)).toBe(
      " The page covers the Mastra agent framework.",
    );
  });

  it("names the frontend alone when the framework has no graph node", () => {
    expect(pageTopicSentence(SPRING_AI, VUE)).toBe(
      " The page covers the Vue frontend.",
    );
  });

  it("names nothing the graph does not know", () => {
    expect(pageTopicSentence(SPRING_AI, SLACK)).toBe("");
    expect(pageTopicSentence(undefined, undefined)).toBe("");
  });
});
