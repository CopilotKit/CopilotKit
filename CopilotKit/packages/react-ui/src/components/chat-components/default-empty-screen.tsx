"use client";
import React from "react";
import { UseChatHelpers } from "ai/react";

import { Button } from "./ui/button";
import { ExternalLink } from "./external-link";
import { IconArrowRight } from "./ui/icons";

const exampleMessages = [
  {
    heading: "Explain technical concepts",
    message: `What is a "serverless function"?`,
  },
  {
    heading: "Summarize an article",
    message: "Summarize the following article for a 2nd grader: \n",
  },
  {
    heading: "Draft an email",
    message: `Draft an email to my boss about the following: \n`,
  },
];

export interface EmptyScreenProps {
  setInput: React.Dispatch<React.SetStateAction<string>>;
}

export const DefaultEmptyScreen: React.FC<EmptyScreenProps> = (props) => {
  return (
    <div className="mx-auto max-w-2xl px-4">
      <div className="rounded-lg border bg-background p-8">
        <h1 className="mb-2 text-lg font-semibold">Welcome to CopilotKit! 👋</h1>
        <p className="mb-2 leading-normal text-muted-foreground">
          This is a Copilot built with{" "}
          <ExternalLink href="https://recursively.ai">recursively.ai's</ExternalLink>{" "}
          <ExternalLink href="https://github.com/RecursivelyAI/CopilotKit">CopilotKit</ExternalLink>{" "}
          .
        </p>
        <p className="leading-normal text-muted-foreground">
          You can start a conversation here or try the following examples:
        </p>
        <div className="mt-4 flex flex-col items-start space-y-2">
          {exampleMessages.map((message, index) => (
            <Button
              key={index}
              variant="link"
              className="h-auto p-0 text-base"
              onClick={() => props.setInput(message.message)}
            >
              <IconArrowRight className="mr-2 text-muted-foreground" />
              {message.heading}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
};
