using System.Text.Json;
using Microsoft.Extensions.AI;

namespace MsAgentHarnessControlRoom.Agent;

/// <summary>
/// Developer-owned glue that lets the Control Room frontend ask the agent for
/// per-turn structured output by passing a JSON-Schema directive through
/// AG-UI's <c>forwardedProps</c> channel.
/// <para>
/// MAF's AG-UI bridge already deserializes <c>RunAgentInput.forwardedProps</c>
/// into <see cref="ChatOptions.AdditionalProperties"/> under the key
/// <c>"ag_ui_forwarded_properties"</c>. MAF itself does NOT promote any well-known
/// shape from that bag into a typed <see cref="ChatOptions.ResponseFormat"/>;
/// that's by design — the framework can't know which convention each
/// application wants to adopt.
/// </para>
/// <para>
/// This <see cref="DelegatingChatClient"/> wrapper is our application's
/// convention. It looks for an OpenAI-shaped <c>responseFormat</c> on
/// <c>forwardedProps</c> and assigns the per-call
/// <see cref="ChatOptions.ResponseFormat"/> before forwarding to the wrapped
/// <see cref="IChatClient"/>. Wire shape (mirroring OpenAI Chat Completions):
/// </para>
/// <code>
/// {
///   "forwardedProps": {
///     "responseFormat": {
///       "type": "json_schema",
///       "json_schema": {
///         "name": "FixtureDiagnosis",
///         "description": "Structured diagnosis emitted by the agent.",
///         "schema": { /* JSON Schema draft 2020-12 */ },
///         "strict": true
///       }
///     }
///   }
/// }
/// </code>
/// <para>
/// Setting <c>type: "text"</c> explicitly opts out (useful when an upstream
/// layer set a schema and the current turn shouldn't honor it). Omitting the
/// field altogether is a no-op — the agent uses whatever
/// <see cref="HarnessAgentOptions.ChatOptions"/> specified at construction.
/// </para>
/// </summary>
internal sealed class ForwardedPropsResponseFormatPromoter : DelegatingChatClient
{
    private const string ForwardedPropsKey = "ag_ui_forwarded_properties";
    private const string ResponseFormatKey = "responseFormat";

    public ForwardedPropsResponseFormatPromoter(IChatClient innerClient)
        : base(innerClient)
    {
    }

    public override Task<ChatResponse> GetResponseAsync(
        IEnumerable<ChatMessage> messages,
        ChatOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        PromoteResponseFormat(options);
        return base.GetResponseAsync(messages, options, cancellationToken);
    }

    public override IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
        IEnumerable<ChatMessage> messages,
        ChatOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        PromoteResponseFormat(options);
        return base.GetStreamingResponseAsync(messages, options, cancellationToken);
    }

    private static void PromoteResponseFormat(ChatOptions? options)
    {
        if (options?.AdditionalProperties is null) return;
        if (!options.AdditionalProperties.TryGetValue(ForwardedPropsKey, out var raw)) return;
        if (raw is not JsonElement forwarded) return;
        if (forwarded.ValueKind != JsonValueKind.Object) return;
        if (!forwarded.TryGetProperty(ResponseFormatKey, out var rf)) return;
        if (rf.ValueKind != JsonValueKind.Object) return;

        if (TryParseResponseFormat(rf) is { } parsed)
        {
            options.ResponseFormat = parsed;
        }
    }

    private static ChatResponseFormat? TryParseResponseFormat(JsonElement rf)
    {
        if (!rf.TryGetProperty("type", out var typeEl) || typeEl.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        var type = typeEl.GetString();
        switch (type)
        {
            case "text":
                return ChatResponseFormat.Text;
            case "json":
                return ChatResponseFormat.Json;
            case "json_schema":
                if (!rf.TryGetProperty("json_schema", out var jsEl)
                    || jsEl.ValueKind != JsonValueKind.Object
                    || !jsEl.TryGetProperty("schema", out var schemaEl)
                    || schemaEl.ValueKind == JsonValueKind.Undefined)
                {
                    return null;
                }

                var name = jsEl.TryGetProperty("name", out var n) && n.ValueKind == JsonValueKind.String
                    ? n.GetString()
                    : null;
                var description = jsEl.TryGetProperty("description", out var d) && d.ValueKind == JsonValueKind.String
                    ? d.GetString()
                    : null;
                return ChatResponseFormat.ForJsonSchema(
                    schema: schemaEl,
                    schemaName: name,
                    schemaDescription: description);
            default:
                return null;
        }
    }
}
