using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using Xunit;

using SSA = SharedStateAgent;

namespace MsAgentDotnet.AgentTests;

/// <summary>
/// Tests covering the SharedStateAgent streaming path. Specifically that the
/// caller-supplied IEnumerable&lt;ChatMessage&gt; is enumerated exactly once,
/// so single-use iterators (e.g. yield-based generators) don't silently yield
/// nothing on a second pass and lose user context on the summary request.
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

    // IEnumerable wrapper that records how many times GetEnumerator is called
    // so tests can assert the expected enumeration count.
    //
    // NOTE: this tracker does NOT enforce a single-use contract at the
    // iterator level — a second `GetEnumerator()` call still returns a fresh,
    // valid enumerator over the same backing array. Tests must explicitly
    // `Assert.Equal(1, messages.EnumerationCount)` to catch double-enumeration
    // regressions. The name reflects what the type actually does (counts
    // enumerations) rather than what it does not do (enforce single use).
    private sealed class EnumerationCountingMessages : IEnumerable<ChatMessage>
    {
        private readonly ChatMessage[] _messages;
        private int _enumerations;

        public int EnumerationCount => _enumerations;

        public EnumerationCountingMessages(params ChatMessage[] messages)
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
        var messages = new EnumerationCountingMessages(new ChatMessage(ChatRole.User, "hi"));

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
        var messages = new EnumerationCountingMessages(new ChatMessage(ChatRole.User, "update my pipeline"));

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

    // Inner agent that emits a controllable sequence of text-only updates on
    // the first RunStreamingAsync call and nothing on subsequent calls. Used
    // to exercise the buffered-text cap and the deserialize-success paths.
    private sealed class TextEmittingAgent : AIAgent
    {
        private readonly IReadOnlyList<string> _firstPassChunks;
        private readonly string? _secondPassChunk;
        private int _callCount;

        public TextEmittingAgent(IReadOnlyList<string> firstPassChunks, string? secondPassChunk = null)
        {
            _firstPassChunks = firstPassChunks;
            _secondPassChunk = secondPassChunk;
        }

        public override AgentThread GetNewThread() => throw new NotImplementedException();

        public override AgentThread DeserializeThread(JsonElement serializedThread, JsonSerializerOptions? jsonSerializerOptions = null)
            => throw new NotImplementedException();

        public override Task<AgentRunResponse> RunAsync(IEnumerable<ChatMessage> messages, AgentThread? thread = null, AgentRunOptions? options = null, CancellationToken cancellationToken = default)
            => Task.FromResult(new AgentRunResponse());

        public override async IAsyncEnumerable<AgentRunResponseUpdate> RunStreamingAsync(
            IEnumerable<ChatMessage> messages,
            AgentThread? thread = null,
            AgentRunOptions? options = null,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            var call = Interlocked.Increment(ref _callCount);
            var chunks = call == 1 ? _firstPassChunks : (_secondPassChunk is null ? Array.Empty<string>() : new[] { _secondPassChunk });
            foreach (var chunk in chunks)
            {
                yield return new AgentRunResponseUpdate
                {
                    Role = ChatRole.Assistant,
                    Contents = [new TextContent(chunk)],
                };
            }
            await Task.CompletedTask;
        }
    }

    [Fact]
    public async Task RunStreamingAsync_BufferedTextCap_DropsUpdatesBeyondCap()
    {
        // Pathological first-pass response: emit many text chunks whose total
        // length exceeds MaxBufferedTextChars. The deserialize will fail
        // (plain text is not valid JSON for SalesStateSnapshot), so we fall
        // back to replaying the buffered text updates. The total replayed
        // character count must NOT exceed the cap plus the largest single
        // chunk size — anything beyond that signals the cap isn't enforced.
        const int chunkSize = 10_000;
        const int chunkCount = 150; // 1.5 MB total — exceeds the 1 MB cap.
        var chunks = Enumerable.Range(0, chunkCount).Select(_ => new string('x', chunkSize)).ToArray();
        var inner = new TextEmittingAgent(chunks);
        var agent = new SSA(inner, CreateSerializerOptions());

        var statePayload = JsonDocument.Parse("{\"todos\":[{\"id\":\"a\",\"title\":\"Deal 1\"}]}").RootElement;
        var chatOptions = new ChatOptions
        {
            AdditionalProperties = new AdditionalPropertiesDictionary
            {
                ["ag_ui_state"] = statePayload,
            },
        };
        var options = new ChatClientAgentRunOptions { ChatOptions = chatOptions };

        var totalReplayedChars = 0;
        await foreach (var update in agent.RunStreamingAsync(new[] { new ChatMessage(ChatRole.User, "hi") }, options: options))
        {
            foreach (var c in update.Contents.OfType<TextContent>())
            {
                totalReplayedChars += c.Text?.Length ?? 0;
            }
        }

        // Replay must be bounded strictly by the cap. The buffering admission
        // check is pre-increment: a chunk that WOULD cross the cap is rejected
        // in full (no partial admission), and already-admitted chunks are
        // kept. So the replayed total is always <= MaxBufferedTextChars — no
        // slack. If enforcement ever becomes post-increment (admit first, then
        // check), the bound would loosen to <= MaxBufferedTextChars + chunkSize
        // and this assertion would need to relax accordingly.
        Assert.True(
            totalReplayedChars <= SSA.MaxBufferedTextChars,
            $"Replayed {totalReplayedChars} chars; cap is {SSA.MaxBufferedTextChars}.");
    }

    [Fact]
    public async Task RunStreamingAsync_DeserializeSuccess_NoSalesData_SkipsDataContentEmit()
    {
        // First-pass produces a syntactically valid SalesStateSnapshot with
        // an empty todos array. TryDeserialize succeeds, but
        // ShouldEmitStateSnapshot returns false because todos is empty, so no
        // DataContent is emitted. The second pass (for the summary) is
        // allowed to run; we assert the absence of DataContent across the
        // full output rather than counting exact updates.
        var firstPass = new[] { "{\"todos\":[]}" };
        var inner = new TextEmittingAgent(firstPass, secondPassChunk: "ok");
        var agent = new SSA(inner, CreateSerializerOptions());

        var statePayload = JsonDocument.Parse("{\"todos\":[{\"id\":\"a\",\"title\":\"Deal 1\"}]}").RootElement;
        var chatOptions = new ChatOptions
        {
            AdditionalProperties = new AdditionalPropertiesDictionary
            {
                ["ag_ui_state"] = statePayload,
            },
        };
        var options = new ChatClientAgentRunOptions { ChatOptions = chatOptions };

        var hasDataContent = false;
        await foreach (var update in agent.RunStreamingAsync(new[] { new ChatMessage(ChatRole.User, "hi") }, options: options))
        {
            if (update.Contents.Any(c => c is DataContent))
            {
                hasDataContent = true;
            }
        }

        Assert.False(hasDataContent, "Empty-todos snapshot must not be emitted as DataContent.");
    }
}
