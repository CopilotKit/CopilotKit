import { Field, InterfaceType, ObjectType } from "type-graphql";
import { MessageRole, ActionExecutionScope } from "./enums";
import { MessageStatusUnion} from "./message-status.type";
import { ResponseStatusUnion } from "./response-status.type";

@InterfaceType({
  resolveType(value) {
    if (value.hasOwnProperty("content")) {
      return TextMessageOutput;
    } else if (value.hasOwnProperty("name")) {
      return ActionExecutionMessageOutput;
    } else if (value.hasOwnProperty("result")) {
      return ResultMessageOutput;
    }
    return undefined;
  },
})

abstract class BaseMessageOutput {
  @Field(() => String)
  id: string;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => MessageStatusUnion)
  status: typeof MessageStatusUnion;
}

@ObjectType({ implements: BaseMessageOutput })
export class TextMessageOutput {
  @Field(() => MessageRole)
  role: MessageRole;

  @Field(() => [String])
  content: string[];
}

@ObjectType({ implements: BaseMessageOutput })
export class ActionExecutionMessageOutput {
  @Field(() => String)
  name: string;

  @Field(() => ActionExecutionScope)
  scope: ActionExecutionScope;

  @Field(() => [String])
  arguments: string[];
}

@ObjectType({ implements: BaseMessageOutput })
export class ResultMessageOutput {
  @Field(() => String)
  actionExecutionId: string;

  @Field(() => String)
  actionName: string;

  @Field(() => String)
  result: string;
}

@ObjectType()
export class CopilotResponse {
  @Field(() => String)
  threadId!: string;

  @Field(() => ResponseStatusUnion)
  status: typeof ResponseStatusUnion;

  @Field({ nullable: true })
  runId?: string;

  @Field(() => [BaseMessageOutput])
  messages: (typeof BaseMessageOutput)[];
}
