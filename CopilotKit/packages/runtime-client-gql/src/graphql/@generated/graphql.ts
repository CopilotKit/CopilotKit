/* eslint-disable */
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
};

export type ActionExecutionMessageOutput = BaseMessageOutput & {
  __typename?: 'ActionExecutionMessageOutput';
  arguments: Array<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
  role: MessageRole;
  scope: ActionExecutionScope;
  status: MessageStatus;
};

/** The scope of the action */
export enum ActionExecutionScope {
  Client = 'client',
  Server = 'server'
}

export type ActionInput = {
  description: Scalars['String']['input'];
  jsonSchema: Scalars['String']['input'];
  name: Scalars['String']['input'];
};

export type BaseMessageOutput = {
  id: Scalars['String']['output'];
  role: MessageRole;
  status: MessageStatus;
};

export type CloudInput = {
  guardrails: GuardrailsInput;
};

export type FrontendInput = {
  actions: Array<ActionInput>;
  toDeprecate_fullContext?: InputMaybe<Scalars['String']['input']>;
};

export type GenerateResponseInput = {
  cloud?: InputMaybe<CloudInput>;
  frontend: FrontendInput;
  messages: Array<MessageInput>;
  runId?: InputMaybe<Scalars['String']['input']>;
  threadId?: InputMaybe<Scalars['String']['input']>;
};

export type GeneratedResponse = {
  __typename?: 'GeneratedResponse';
  interruption: GenerationInterruption;
  messages: Array<BaseMessageOutput>;
  runId?: Maybe<Scalars['String']['output']>;
  threadId: Scalars['String']['output'];
};

export type GenerationInterruption = {
  __typename?: 'GenerationInterruption';
  interrupted: Scalars['Boolean']['output'];
  reason?: Maybe<Scalars['String']['output']>;
};

export type GuardrailsInput = {
  inputValidationRules?: InputMaybe<Array<GuardrailsRuleInput>>;
};

export type GuardrailsRuleInput = {
  allowList?: InputMaybe<Array<Scalars['String']['input']>>;
  denyList?: InputMaybe<Array<Scalars['String']['input']>>;
  id: Scalars['String']['input'];
};

export type MessageInput = {
  id: Scalars['String']['input'];
  role: MessageRole;
  textMessage?: InputMaybe<TextMessageInput>;
  type: MessageInputType;
};

export enum MessageInputType {
  Text = 'text'
}

/** The role of the message */
export enum MessageRole {
  Assistant = 'assistant',
  Function = 'function',
  System = 'system',
  User = 'user'
}

export type MessageStatus = {
  __typename?: 'MessageStatus';
  isDoneStreaming: Scalars['Boolean']['output'];
};

export type Mutation = {
  __typename?: 'Mutation';
  generateResponse: GeneratedResponse;
};


export type MutationGenerateResponseArgs = {
  data: GenerateResponseInput;
};

export type Query = {
  __typename?: 'Query';
  hello: Scalars['String']['output'];
};

export type TextMessageInput = {
  content: Scalars['String']['input'];
};

export type TextMessageOutput = BaseMessageOutput & {
  __typename?: 'TextMessageOutput';
  content: Array<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  role: MessageRole;
  status: MessageStatus;
};

export type GenerateResponseMutationVariables = Exact<{
  data: GenerateResponseInput;
}>;


export type GenerateResponseMutation = { __typename?: 'Mutation', generateResponse: { __typename?: 'GeneratedResponse', threadId: string, runId?: string | null, messages: Array<{ __typename: 'ActionExecutionMessageOutput', id: string, role: MessageRole, name: string, scope: ActionExecutionScope, arguments: Array<string>, status: { __typename?: 'MessageStatus', isDoneStreaming: boolean } } | { __typename: 'TextMessageOutput', id: string, role: MessageRole, content: Array<string>, status: { __typename?: 'MessageStatus', isDoneStreaming: boolean } }> } & ({ __typename?: 'GeneratedResponse', interruption: { __typename?: 'GenerationInterruption', interrupted: boolean, reason?: string | null } } | { __typename?: 'GeneratedResponse', interruption?: never }) };


export const GenerateResponseDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"generateResponse"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"data"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"GenerateResponseInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"generateResponse"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"data"},"value":{"kind":"Variable","name":{"kind":"Name","value":"data"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GeneratedResponse"}},"directives":[{"kind":"Directive","name":{"kind":"Name","value":"defer"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"interruption"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"interrupted"}},{"kind":"Field","name":{"kind":"Name","value":"reason"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"messages"},"directives":[{"kind":"Directive","name":{"kind":"Name","value":"stream"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"BaseMessageOutput"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"role"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"BaseMessageOutput"}},"directives":[{"kind":"Directive","name":{"kind":"Name","value":"defer"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"isDoneStreaming"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"TextMessageOutput"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"content"},"directives":[{"kind":"Directive","name":{"kind":"Name","value":"stream"}}]}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ActionExecutionMessageOutput"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"scope"}},{"kind":"Field","name":{"kind":"Name","value":"arguments"},"directives":[{"kind":"Directive","name":{"kind":"Name","value":"stream"}}]}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"runId"}}]}}]}}]} as unknown as DocumentNode<GenerateResponseMutation, GenerateResponseMutationVariables>;