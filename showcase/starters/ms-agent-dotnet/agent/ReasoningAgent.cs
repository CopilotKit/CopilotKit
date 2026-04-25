using System.Diagnostics.CodeAnalysis;
using System.Runtime.CompilerServices;
using System.Text;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

/// <summary>
/// Agent wrapper that exposes the model's step-by-step thinking as a
/// first-class AG-UI reasoning message, independent of the inner chat
/// client actually supporting native reasoning tokens.
///
/// The inner agent is prompted to produce output of the shape:
///
///   &lt;reasoning&gt;
///   step-by-step thinking...
///   &lt;/reasoning&gt;
///   final concise answer...
///
/// This wrapper streams the response, detects the reasoning block, and
/// re-emits the content inside the block as <see cref="TextReasoningContent"/>
/// chunks while the content after the closing tag is emitted as ordinary
/// <see cref="TextContent"/>. AG-UI hosting surfaces
/// <see cref="TextReasoningContent"/> as <c>REASONING_MESSAGE_*</c> events,
/// which CopilotKit's React packages render via the <c>reasoningMessage</c>
/// slot.
/// </summary>
[SuppressMessage("Performance", "CA1812:Avoid uninstantiated internal classes", Justification = "Instantiated by ReasoningAgentFactory")]
internal sealed class ReasoningAgent : DelegatingAIAgent
{
    private const string OpenTag = "<reasoning>";
    private const string CloseTag = "</reasoning>";

    private readonly ILogger<ReasoningAgent> _logger;

    public ReasoningAgent(AIAgent innerAgent, ILogger<ReasoningAgent>? logger = null)
        : base(innerAgent)
    {
        ArgumentNullException.ThrowIfNull(innerAgent);
        _logger = logger ?? NullLogger<ReasoningAgent>.Instance;
    }

    public override Task<AgentRunResponse> RunAsync(IEnumerable<ChatMessage> messages, AgentThread? thread = null, AgentRunOptions? options = null, CancellationToken cancellationToken = default)
    {
        return RunStreamingAsync(messages, thread, options, cancellationToken).ToAgentRunResponseAsync(cancellationToken);
    }

    /// <summary>
    /// Streams from the inner agent, splitting the produced text into a
    /// reasoning segment (content inside <c>&lt;reasoning&gt;...&lt;/reasoning&gt;</c>)
    /// and an answer segment (everything else).
    /// </summary>
    /// <remarks>
    /// The splitter is deliberately simple: it buffers text across chunks
    /// just enough to reliably detect the open/close tags, then forwards
    /// chunks straight through to minimize perceived latency. Non-text
    /// content (tool calls, data, etc.) is forwarded unchanged so the
    /// split never interferes with the rest of the AG-UI event stream.
    /// </remarks>
    public override async IAsyncEnumerable<AgentRunResponseUpdate> RunStreamingAsync(
        IEnumerable<ChatMessage> messages,
        AgentThread? thread = null,
        AgentRunOptions? options = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(messages);

        var buffer = new StringBuilder();
        var state = SplitState.LookingForOpen;

        await foreach (var update in InnerAgent.RunStreamingAsync(messages, thread, options, cancellationToken).ConfigureAwait(false))
        {
            // Pass through any non-text content (tool calls, data, usage, …)
            // untouched — only text routing is affected by the split.
            var textPieces = new List<string>();
            var passthroughContents = new List<AIContent>();
            foreach (var content in update.Contents)
            {
                if (content is TextContent tc && tc.Text is { Length: > 0 } text)
                {
                    textPieces.Add(text);
                }
                else if (content is not TextContent)
                {
                    passthroughContents.Add(content);
                }
            }

            if (passthroughContents.Count > 0)
            {
                yield return new AgentRunResponseUpdate
                {
                    AuthorName = update.AuthorName,
                    Role = update.Role,
                    MessageId = update.MessageId,
                    ResponseId = update.ResponseId,
                    CreatedAt = update.CreatedAt,
                    Contents = passthroughContents,
                };
            }

            foreach (var piece in textPieces)
            {
                foreach (var emitted in RouteText(piece, buffer, ref state))
                {
                    yield return BuildUpdate(update, emitted.Content, emitted.IsReasoning);
                }
            }
        }

        // Flush anything left in the buffer as whichever stream we're
        // currently in. If we never saw an opening tag the remaining text
        // is an answer; if we're mid-reasoning we conservatively emit the
        // tail as reasoning so the user still sees it.
        if (buffer.Length > 0)
        {
            var remainder = buffer.ToString();
            buffer.Clear();
            var isReasoning = state == SplitState.InsideReasoning;
            yield return BuildTrailingUpdate(remainder, isReasoning);
        }
    }

    private static AgentRunResponseUpdate BuildUpdate(AgentRunResponseUpdate source, string content, bool isReasoning)
    {
        AIContent aiContent = isReasoning ? new TextReasoningContent(content) : new TextContent(content);
        return new AgentRunResponseUpdate
        {
            AuthorName = source.AuthorName,
            Role = source.Role,
            MessageId = source.MessageId,
            ResponseId = source.ResponseId,
            CreatedAt = source.CreatedAt,
            Contents = [aiContent],
        };
    }

    private static AgentRunResponseUpdate BuildTrailingUpdate(string content, bool isReasoning)
    {
        AIContent aiContent = isReasoning ? new TextReasoningContent(content) : new TextContent(content);
        return new AgentRunResponseUpdate
        {
            Contents = [aiContent],
        };
    }

    /// <summary>
    /// Incremental splitter. Appends <paramref name="piece"/> to
    /// <paramref name="buffer"/> and yields zero or more text fragments
    /// classified as reasoning vs. answer, advancing <paramref name="state"/>
    /// as open/close tags are encountered.
    /// </summary>
    /// <remarks>
    /// We only hold back the suffix of <paramref name="buffer"/> that could
    /// be the start of the tag we're currently searching for — everything
    /// older is safe to emit. That keeps streaming latency close to the
    /// inner agent's.
    /// </remarks>
    private static IEnumerable<(string Content, bool IsReasoning)> RouteText(string piece, StringBuilder buffer, ref SplitState state)
    {
        buffer.Append(piece);
        var results = new List<(string, bool)>();

        while (true)
        {
            if (state == SplitState.LookingForOpen)
            {
                var full = buffer.ToString();
                var openIdx = full.IndexOf(OpenTag, StringComparison.Ordinal);
                if (openIdx >= 0)
                {
                    // Anything before the open tag is answer text.
                    if (openIdx > 0)
                    {
                        results.Add((full[..openIdx], false));
                    }
                    // Drop the tag itself and switch state.
                    buffer.Clear();
                    buffer.Append(full[(openIdx + OpenTag.Length)..]);
                    state = SplitState.InsideReasoning;
                    continue;
                }

                // No open tag yet. Emit everything except a trailing
                // partial-match suffix that could still become the tag.
                var safe = SafePrefix(full, OpenTag);
                if (safe > 0)
                {
                    results.Add((full[..safe], false));
                    buffer.Clear();
                    buffer.Append(full[safe..]);
                }
                break;
            }

            if (state == SplitState.InsideReasoning)
            {
                var full = buffer.ToString();
                var closeIdx = full.IndexOf(CloseTag, StringComparison.Ordinal);
                if (closeIdx >= 0)
                {
                    if (closeIdx > 0)
                    {
                        results.Add((full[..closeIdx], true));
                    }
                    buffer.Clear();
                    buffer.Append(full[(closeIdx + CloseTag.Length)..]);
                    state = SplitState.AfterReasoning;
                    continue;
                }

                var safe = SafePrefix(full, CloseTag);
                if (safe > 0)
                {
                    results.Add((full[..safe], true));
                    buffer.Clear();
                    buffer.Append(full[safe..]);
                }
                break;
            }

            // AfterReasoning — everything is answer text; flush buffer.
            if (buffer.Length > 0)
            {
                results.Add((buffer.ToString(), false));
                buffer.Clear();
            }
            break;
        }

        return results;
    }

    /// <summary>
    /// Returns the largest index <c>k</c> such that the suffix starting at
    /// <c>k</c> of <paramref name="text"/> cannot itself be the start of
    /// <paramref name="tag"/>. Everything up to <c>k</c> is safe to emit.
    /// </summary>
    private static int SafePrefix(string text, string tag)
    {
        var maxHoldback = Math.Min(text.Length, tag.Length - 1);
        for (var hold = maxHoldback; hold > 0; hold--)
        {
            var suffix = text[^hold..];
            if (tag.StartsWith(suffix, StringComparison.Ordinal))
            {
                return text.Length - hold;
            }
        }
        return text.Length;
    }

    private enum SplitState
    {
        LookingForOpen,
        InsideReasoning,
        AfterReasoning,
    }
}

/// <summary>
/// Builds a reasoning-capable <see cref="AIAgent"/> on top of an OpenAI
/// chat client. The agent is instructed to bracket its chain-of-thought in
/// <c>&lt;reasoning&gt;...&lt;/reasoning&gt;</c> tags so <see cref="ReasoningAgent"/>
/// can reroute it into AG-UI reasoning events.
/// </summary>
internal static class ReasoningAgentFactory
{
    internal const string SystemPrompt =
        "You are a helpful assistant. For each user question, first think step-by-step " +
        "about the approach, then give a concise final answer.\n\n" +
        "Format your response EXACTLY like this, with no other preamble:\n" +
        "<reasoning>\n" +
        "your step-by-step thinking here, one thought per line\n" +
        "</reasoning>\n" +
        "your concise final answer here\n\n" +
        "The <reasoning>...</reasoning> tags are mandatory and must appear before the final answer.";

    public static AIAgent Create(IChatClient chatClient, ILoggerFactory loggerFactory)
    {
        ArgumentNullException.ThrowIfNull(chatClient);
        ArgumentNullException.ThrowIfNull(loggerFactory);

        var inner = new ChatClientAgent(
            chatClient,
            name: "ReasoningAgent",
            description: SystemPrompt);

        return new ReasoningAgent(inner, loggerFactory.CreateLogger<ReasoningAgent>());
    }
}
