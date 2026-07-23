using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;

namespace MsAgentHarnessControlRoom.Agent;

#pragma warning disable MEAI001 // ToolApprovalRequestContent and friends are still marked Experimental.

/// <summary>
/// Application-owned shim that lets Harness's tool-approval flow survive
/// the trip across the AG-UI wire.
/// <para>
/// MAF's AG-UI bridge serialises only function-call and text content on
/// assistant messages — every other <see cref="AIContent"/> subtype is
/// silently dropped. The approval requests emitted by Harness's
/// <c>ToolApprovalAgent</c> wrapper are one of those casualties. This shim
/// converts them on the way OUT into a synthetic
/// <c>request_approval</c> function call (matches Microsoft's reference
/// implementation in <c>samples/02-agents/AGUI/Step04_HumanInLoop/</c>),
/// and translates the matching tool result back on the way IN.
/// </para>
/// <para>
/// "Don't ask again" is honored by sending an
/// <c>always_approve_tool</c> flag on the tool result; the shim wraps the
/// response in <see cref="AlwaysApproveToolApprovalResponseContent"/> so
/// Harness can record a standing rule in its session state.
/// </para>
/// </summary>
internal sealed class ApprovalContentWireBridge : DelegatingAIAgent
{
    internal const string SyntheticToolName = "request_approval";
    private const string SyntheticCallIdPrefix = "approval:";

    private readonly JsonSerializerOptions _jsonOptions;

    public ApprovalContentWireBridge(AIAgent innerAgent, JsonSerializerOptions? jsonOptions = null)
        : base(innerAgent)
    {
        _jsonOptions = jsonOptions ?? new JsonSerializerOptions(JsonSerializerDefaults.Web);
    }

    protected override Task<AgentResponse> RunCoreAsync(
        IEnumerable<ChatMessage> messages,
        AgentSession? session = null,
        AgentRunOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        return RunCoreStreamingAsync(messages, session, options, cancellationToken)
            .ToAgentResponseAsync(cancellationToken);
    }

    protected override async IAsyncEnumerable<AgentResponseUpdate> RunCoreStreamingAsync(
        IEnumerable<ChatMessage> messages,
        AgentSession? session = null,
        AgentRunOptions? options = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        // Transform incoming approval responses from the client into the typed
        // ToolApproval* shapes the inner Harness loop recognises.
        var processedMessages = ProcessIncomingApprovals(messages.ToList(), _jsonOptions);

        await foreach (var update in InnerAgent.RunStreamingAsync(
            processedMessages, session, options, cancellationToken).ConfigureAwait(false))
        {
            yield return ProcessOutgoingApprovalRequests(update, _jsonOptions);
        }
    }

    // ---------- outbound: ToolApprovalRequestContent → request_approval ----------

    private static AgentResponseUpdate ProcessOutgoingApprovalRequests(
        AgentResponseUpdate update,
        JsonSerializerOptions jsonOptions)
    {
        // First pass: find every ToolApprovalRequestContent + collect the
        // wrapped function call ids so we can drop any sibling
        // FunctionCallContent that shares an id (ApprovalRequiredAIFunction
        // emits both the original call AND the approval request — without
        // this filter, both flow across the AG-UI wire under the same
        // tool_call_id and the deltas concatenate into invalid JSON).
        HashSet<string>? wrappedCallIds = null;
        for (var i = 0; i < update.Contents.Count; i++)
        {
            if (update.Contents[i] is ToolApprovalRequestContent req
                && req.ToolCall is FunctionCallContent fc
                && !string.IsNullOrEmpty(fc.CallId))
            {
                wrappedCallIds ??= new HashSet<string>(StringComparer.Ordinal);
                wrappedCallIds.Add(fc.CallId);
            }
        }
        if (wrappedCallIds is null)
        {
            return update;
        }

        var updatedContents = new List<AIContent>(update.Contents.Count);
        for (var i = 0; i < update.Contents.Count; i++)
        {
            var content = update.Contents[i];
            if (content is ToolApprovalRequestContent request
                && request.ToolCall is FunctionCallContent functionCall)
            {
                var approvalData = new ApprovalRequestPayload
                {
                    ApprovalId = request.RequestId,
                    FunctionName = functionCall.Name,
                    FunctionArguments = functionCall.Arguments,
                    Message = $"Approve execution of '{functionCall.Name}'?",
                };
                // Encode the payload as a JSON string so the wire shape is
                // flat: { "request_json": "<json string>" }.
                var requestJson = JsonSerializer.Serialize(approvalData, jsonOptions);
                // Use a PREFIXED call_id so the synthetic call never
                // collides with the original FunctionCallContent's CallId on
                // the wire. ApprovalRequiredAIFunction streams the original
                // call's tool_call_args events across multiple updates, and
                // those events arrive at the cockpit BEFORE the approval
                // request — so a same-id synthetic call would have its args
                // concatenated with the original's args delta.
                updatedContents.Add(new FunctionCallContent(
                    callId: SyntheticCallIdPrefix + request.RequestId,
                    name: SyntheticToolName,
                    arguments: new Dictionary<string, object?> { ["request_json"] = requestJson }));
            }
            else if (content is FunctionCallContent siblingCall
                && !string.IsNullOrEmpty(siblingCall.CallId)
                && wrappedCallIds.Contains(siblingCall.CallId))
            {
                // Drop the wrapped function call — the approval request
                // already represents it on the wire.
                continue;
            }
            else
            {
                updatedContents.Add(content);
            }
        }

        var chatUpdate = update.AsChatResponseUpdate();
        return new AgentResponseUpdate(new ChatResponseUpdate
        {
            Role = chatUpdate.Role,
            Contents = updatedContents,
            MessageId = chatUpdate.MessageId,
            AuthorName = chatUpdate.AuthorName,
            CreatedAt = chatUpdate.CreatedAt,
            RawRepresentation = chatUpdate.RawRepresentation,
            ResponseId = chatUpdate.ResponseId,
            AdditionalProperties = chatUpdate.AdditionalProperties,
        })
        {
            AgentId = update.AgentId,
            ContinuationToken = update.ContinuationToken,
        };
    }

    // ---------- inbound: request_approval ↔ ToolApprovalRequestContent ----------

    private static List<ChatMessage> ProcessIncomingApprovals(
        List<ChatMessage> messages,
        JsonSerializerOptions jsonOptions)
    {
        // Build a map of synthetic call-id → reconstructed ToolApprovalRequestContent.
        Dictionary<string, ToolApprovalRequestContent> trackedApprovals = [];

        for (int messageIndex = 0; messageIndex < messages.Count; messageIndex++)
        {
            var message = messages[messageIndex];
            List<AIContent>? transformed = null;

            for (int j = 0; j < message.Contents.Count; j++)
            {
                var content = message.Contents[j];

                if (content is FunctionCallContent { Name: SyntheticToolName } syntheticCall)
                {
                    var approval = ConvertSyntheticCallToApprovalRequest(syntheticCall, jsonOptions);
                    transformed ??= CopyContentsUpToIndex(message.Contents, j);
                    transformed.Add(approval);
                    trackedApprovals[syntheticCall.CallId] = approval;
                }
                else if (content is FunctionResultContent result
                    && trackedApprovals.TryGetValue(result.CallId, out var approval))
                {
                    transformed ??= CopyContentsUpToIndex(message.Contents, j);
                    transformed.Add(ConvertResultToApprovalResponse(result, approval, jsonOptions));
                }
                else
                {
                    transformed?.Add(content);
                }
            }

            if (transformed is not null)
            {
                messages[messageIndex] = new ChatMessage(message.Role, transformed)
                {
                    AuthorName = message.AuthorName,
                    MessageId = message.MessageId,
                    CreatedAt = message.CreatedAt,
                    RawRepresentation = message.RawRepresentation,
                    AdditionalProperties = message.AdditionalProperties,
                };
            }
        }

        return messages;
    }

    private static ToolApprovalRequestContent ConvertSyntheticCallToApprovalRequest(
        FunctionCallContent syntheticCall,
        JsonSerializerOptions jsonOptions)
    {
        if (syntheticCall.Arguments is null
            || !syntheticCall.Arguments.TryGetValue("request_json", out var raw))
        {
            throw new InvalidOperationException(
                "request_approval tool call missing required 'request_json' argument.");
        }

        string? requestJson = raw switch
        {
            string s => s,
            JsonElement el when el.ValueKind == JsonValueKind.String => el.GetString(),
            _ => null,
        };
        if (string.IsNullOrEmpty(requestJson))
        {
            throw new InvalidOperationException(
                "request_approval tool call's 'request_json' field is not a string.");
        }

        var payload = JsonSerializer.Deserialize<ApprovalRequestPayload>(requestJson, jsonOptions)
            ?? throw new InvalidOperationException(
                "Failed to deserialize ApprovalRequestPayload from request_json.");

        return new ToolApprovalRequestContent(
            requestId: payload.ApprovalId,
            new FunctionCallContent(
                callId: payload.ApprovalId,
                name: payload.FunctionName,
                arguments: payload.FunctionArguments));
    }

    private static AIContent ConvertResultToApprovalResponse(
        FunctionResultContent result,
        ToolApprovalRequestContent approval,
        JsonSerializerOptions jsonOptions)
    {
        ApprovalResponsePayload? payload = result.Result switch
        {
            JsonElement el => el.Deserialize<ApprovalResponsePayload>(jsonOptions),
            ApprovalResponsePayload p => p,
            string s => JsonSerializer.Deserialize<ApprovalResponsePayload>(s, jsonOptions),
            _ => null,
        };
        payload ??= new ApprovalResponsePayload { Approved = false };

        if (payload.AlwaysApprove)
        {
            return approval.CreateAlwaysApproveToolResponse(
                reason: "User selected 'don't ask again' from the cockpit.");
        }
        return approval.CreateResponse(approved: payload.Approved);
    }

    private static List<AIContent> CopyContentsUpToIndex(IList<AIContent> contents, int index)
    {
        var copy = new List<AIContent>(index);
        for (int i = 0; i < index; i++)
        {
            copy.Add(contents[i]);
        }
        return copy;
    }

    // ---------- wire payloads ----------

    internal sealed class ApprovalRequestPayload
    {
        [JsonPropertyName("approval_id")]
        public required string ApprovalId { get; init; }

        [JsonPropertyName("function_name")]
        public required string FunctionName { get; init; }

        [JsonPropertyName("function_arguments")]
        public IDictionary<string, object?>? FunctionArguments { get; init; }

        [JsonPropertyName("message")]
        public string? Message { get; init; }
    }

    internal sealed class ApprovalResponsePayload
    {
        [JsonPropertyName("approval_id")]
        public string? ApprovalId { get; init; }

        [JsonPropertyName("approved")]
        public required bool Approved { get; init; }

        [JsonPropertyName("always_approve")]
        public bool AlwaysApprove { get; init; }
    }
}

#pragma warning restore MEAI001
