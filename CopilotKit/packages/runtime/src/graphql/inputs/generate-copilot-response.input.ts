import { Field, InputType } from "type-graphql";
import { MessageInput } from "./message.input";
import { FrontendInput } from "./frontend.input";
import { CloudInput } from "./cloud.input";
import { CopilotRequestType } from "../types/enums";
import { ForwardedParametersInput } from "./forwarded-parameters.input";

@InputType()
export class GenerateCopilotResponseMetadataInput {
  @Field(() => CopilotRequestType, { nullable: true })
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

  @Field(() => ForwardedParametersInput, { nullable: true })
  forwardedParameters?: ForwardedParametersInput;
}
