using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using Xunit;

using SSA = SharedStateAgent;

namespace MsAgentDotnet.AgentTests;

/// <summary>
/// Tests covering the SharedStateAgent streaming path — specifically that the
/// caller-supplied IEnumerable&lt;ChatMessage&gt; is enumerated exactly once
/// (finding 1) so that single-use iterators (e.g. yield-based generators)
/// behave correctly.
/// </summary>
public class SharedStateAgentStreamingTests
{
    // SharedStateAgent's ctor validates that JsonSerializerOptions can resolve
    // JsonElement. Attach the reflection-based DefaultJsonTypeInfoResolver so
    // the ctor's shape check succeeds (production uses the source-gen context).
    private static JsonSerializerOptions CreateSerializerOptions() =>
        new(JsonSerializerDefaults.Web)
        {
            TypeInfoResolver = new System.Text.Json.Serialization.Metadata.DefaultJsonTypeInfoResolver(),
        };


    // Minimal AIAgent fake: records invocations + yields nothing. We don't care
    // what the inner agent produces for the enumeration-count test; we just
    // need the SharedStateAgent wrapper to call us and have us observe the
    // `messages` IEnumerable.
    private sealed class RecordingAgent : AIAgent
    {
        public int RunStreamingCalls { get; private set; }
        public List<List<ChatMessage>> CapturedMessageSnapshots { get; } = new();

        public override AgentThread GetNewThread() => throw new NotImplementedException();

        public override AgentThread DeserializeThread(JsonElement serializedThread, JsonSerializerOptions? jsonSerializerOptions = null)
            => throw new NotImplementedException();

        public override Task<AgentRunResponse> RunAsync(IEnumerable<ChatMessage> messages, AgentThread? thread = null, AgentRunOptions? options = null, CancellationToken cancellationToken = default)
        {
            var list = messages.ToList();
            CapturedMessageSnapshots.Add(list);
            return Task.FromResult(new AgentRunResponse());
        }

        public override async IAsyncEnumerable<AgentRunResponseUpdate> RunStreamingAsync(
            IEnumerable<ChatMessage> messages,
            AgentThread? thread = null,
            AgentRunOptions? options = null,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            RunStreamingCalls++;
            // Materialize the incoming messages to capture them. (The outer
            // SharedStateAgent is expected to have already materialized them
            // once — we don't re-enumerate the caller's original iterator.)
            var snapshot = messages.ToList();
            CapturedMessageSnapshots.Add(snapshot);
            await Task.CompletedTask;
            yield break;
        }
    }

    // IEnumerable wrapper that tracks how many times GetEnumerator is called.
    // A single-use iterator (yield return) would produce nothing on a second
    // pass; this fake is stricter — it asserts at most one enumeration, so a
    // bug that enumerated twice fails loudly rather than silently producing
    // empty results.
    private sealed class SingleUseMessages : IEnumerable<ChatMessage>
    {
        private readonly ChatMessage[] _messages;
        private int _enumerations;

        public int EnumerationCount => _enumerations;

        public SingleUseMessages(params ChatMessage[] messages)
        {
            _messages = messages;
        }

        public IEnumerator<ChatMessage> GetEnumerator()
        {
            _enumerations++;
            return ((IEnumerable<ChatMessage>)_messages).GetEnumerator();
        }

        System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator() => GetEnumerator();
    }

    [Fact]
    public async Task RunStreamingAsync_NoAgUiState_EnumeratesCallerMessagesOnce()
    {
        // When there's no AG-UI state attached, the non-structured path runs.
        // Even here a naive implementation could accidentally enumerate twice
        // (e.g. for logging). Verify we only enumerate the caller's iterator
        // a single time — we then pass the materialized list to the inner
        // agent.
        var inner = new RecordingAgent();
        var agent = new SSA(inner, CreateSerializerOptions());
        var messages = new SingleUseMessages(new ChatMessage(ChatRole.User, "hi"));

        await foreach (var _ in agent.RunStreamingAsync(messages).ConfigureAwait(false))
        {
            // drain
        }

        Assert.Equal(1, messages.EnumerationCount);
        Assert.Equal(1, inner.RunStreamingCalls);
    }

    [Fact]
    public async Task RunStreamingAsync_WithSalesState_EnumeratesCallerMessagesOnce()
    {
        // With sales state attached, SharedStateAgent runs the two-pass
        // structured-output flow: firstRunMessages and secondRunMessages both
        // need the caller's message list. A previous bug enumerated `messages`
        // for each of those appends — a yield-based generator would silently
        // yield nothing on the second pass, and the summary request would run
        // without user context.
        var inner = new RecordingAgent();
        var agent = new SSA(inner, CreateSerializerOptions());
        var messages = new SingleUseMessages(new ChatMessage(ChatRole.User, "update my pipeline"));

        // Attach sales-shaped ag_ui_state so the structured-output path runs.
        var statePayload = JsonDocument.Parse("{\"todos\":[{\"id\":\"a\",\"title\":\"Deal 1\"}]}").RootElement;
        var chatOptions = new ChatOptions
        {
            AdditionalProperties = new AdditionalPropertiesDictionary
            {
                ["ag_ui_state"] = statePayload,
            },
        };
        var options = new ChatClientAgentRunOptions { ChatOptions = chatOptions };

        await foreach (var _ in agent.RunStreamingAsync(messages, options: options).ConfigureAwait(false))
        {
            // drain
        }

        // The critical assertion: caller's iterator was enumerated exactly
        // once, regardless of how many times SharedStateAgent needs to compose
        // derived message lists internally.
        Assert.Equal(1, messages.EnumerationCount);
    }
}
