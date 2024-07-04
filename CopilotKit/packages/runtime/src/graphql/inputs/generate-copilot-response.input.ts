import { Field, InputType, registerEnumType } from "type-graphql";
import { MessageInput } from "./message.input";
import { FrontendInput } from "./frontend.input";
import { CloudInput } from "./cloud.input";

export enum CopilotRequestType {
  Chat = "Chat",
  Task = "Task",
  TextareaCompletion = "TextareaCompletion",
  TextareaPopover = "TextareaPopover",
  Suggestion = "Suggestion",
}

registerEnumType(CopilotRequestType, {
  name: "CopilotRequestType",
  description: "The type of Copilot request",
});

@InputType()
export class GenerateCopilotResponseMetadataInput {
  @Field(() => String, { nullable: true })
  requestType: CopilotRequestType;
}

@InputType()
export class GenerateCopilotResponseInput {
  @Field(() => GenerateCopilotResponseMetadataInput, { nullable: false })
  metadata: GenerateCopilotResponseMetadataInput;

  @Field(() => String, { nullable: true })
  threadId?: string;

  @Field(() => String, { nullable: true })
  runId?: string;

  @Field(() => [MessageInput])
  messages: MessageInput[];

  @Field(() => FrontendInput)
  frontend: FrontendInput;

  @Field(() => CloudInput, { nullable: true })
  cloud?: CloudInput;
}
