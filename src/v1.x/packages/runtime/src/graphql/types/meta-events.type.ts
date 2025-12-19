import { createUnionType, Field, InterfaceType, ObjectType, registerEnumType } from "type-graphql";
import {
  ActionExecutionMessageOutput,
  AgentStateMessageOutput,
  BaseMessageOutput,
  ResultMessageOutput,
  TextMessageOutput,
} from "./copilot-response.type";

export enum MetaEventName {
  LangGraphInterruptEvent = "LangGraphInterruptEvent",
  CopilotKitLangGraphInterruptEvent = "CopilotKitLangGraphInterruptEvent",
}

registerEnumType(MetaEventName, {
  name: "MetaEventName",
  description: "Meta event types",
});

@InterfaceType({
  resolveType(value) {
    if (value.name === MetaEventName.LangGraphInterruptEvent) {
      return LangGraphInterruptEvent;
    } else if (value.name === MetaEventName.CopilotKitLangGraphInterruptEvent) {
      return CopilotKitLangGraphInterruptEvent;
    }
    return undefined;
  },
})
@InterfaceType()
export abstract class BaseMetaEvent {
  @Field(() => String)
  type: "MetaEvent" = "MetaEvent";

  @Field(() => MetaEventName)
  name: MetaEventName;
}

@ObjectType()
export class CopilotKitLangGraphInterruptEventData {
  @Field(() => String)
  value: string;

  @Field(() => [BaseMessageOutput])
  messages: (typeof BaseMessageOutput)[];
}

@ObjectType({ implements: BaseMetaEvent })
export class LangGraphInterruptEvent {
  @Field(() => MetaEventName)
  name: MetaEventName.LangGraphInterruptEvent = MetaEventName.LangGraphInterruptEvent;

  @Field(() => String)
  value: string;

  @Field(() => String, { nullable: true })
  response?: string;
}

@ObjectType({ implements: BaseMetaEvent })
export class CopilotKitLangGraphInterruptEvent {
  @Field(() => MetaEventName)
  name: MetaEventName.CopilotKitLangGraphInterruptEvent =
    MetaEventName.CopilotKitLangGraphInterruptEvent;

  @Field(() => CopilotKitLangGraphInterruptEventData)
  data: CopilotKitLangGraphInterruptEventData;

  @Field(() => String, { nullable: true })
  response?: string;
}
