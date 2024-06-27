import { GraphQLJSON } from "graphql-scalars";
import { Field, InterfaceType, ObjectType, createUnionType, registerEnumType } from "type-graphql";

export enum ResponseStatusCode {
  Pending = "pending",
  Success = "success",
  Failed = "failed",
}

registerEnumType(ResponseStatusCode, {
  name: "ResponseStatusCode",
});

@InterfaceType({
  resolveType(value) {
    if (value.code === ResponseStatusCode.Success) {
      return SuccessResponseStatus;
    } else if (value.code === ResponseStatusCode.Failed) {
      return FailedResponseStatus;
    } else if (value.code === ResponseStatusCode.Pending) {
      return PendingResponseStatus;
    }
    return undefined;
  },
})
@ObjectType()
abstract class BaseResponseStatus {
  @Field(() => ResponseStatusCode)
  code: ResponseStatusCode;
}

@ObjectType({ implements: BaseResponseStatus })
export class PendingResponseStatus extends BaseResponseStatus {
  code: ResponseStatusCode = ResponseStatusCode.Pending;
}

@ObjectType({ implements: BaseResponseStatus })
export class SuccessResponseStatus extends BaseResponseStatus {
  code: ResponseStatusCode = ResponseStatusCode.Success;
}

export enum FailedResponseStatusReason {
  GUARDRAILS_VALIDATION_FAILED = "GUARDRAILS_VALIDATION_FAILED",
  MESSAGE_STREAM_INTERRUPTED = "MESSAGE_STREAM_INTERRUPTED",
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
}

registerEnumType(FailedResponseStatusReason, {
  name: "FailedResponseStatusReason",
});

@ObjectType({ implements: BaseResponseStatus })
export class FailedResponseStatus extends BaseResponseStatus {
  code: ResponseStatusCode = ResponseStatusCode.Failed;

  @Field(() => FailedResponseStatusReason)
  reason: FailedResponseStatusReason;

  @Field(() => GraphQLJSON, { nullable: true })
  details?: Record<string, any> = null;
}

export const ResponseStatusUnion = createUnionType({
  name: "ResponseStatus",
  types: () => [PendingResponseStatus, SuccessResponseStatus, FailedResponseStatus] as const,
});
