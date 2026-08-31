using System.Text.Json;
using Microsoft.Extensions.AI;

internal static class MultimodalEndpoint
{
    private static readonly JsonSerializerOptions SseJsonOptions = new(JsonSerializerDefaults.Web);

    public static async Task HandleAsync(
        HttpContext context,
        IChatClient chatClient,
        ILogger logger)
    {
        var cancellationToken = context.RequestAborted;
        string threadId = "";
        string runId = "";
        var messageId = $"msg_{Guid.NewGuid():N}";
        var responseStarted = false;

        try
        {
            using var body = await JsonDocument.ParseAsync(
                context.Request.Body,
                cancellationToken: cancellationToken).ConfigureAwait(false);
            var root = body.RootElement;

            threadId = GetString(root, "threadId") ?? "";
            runId = GetString(root, "runId") ?? Guid.NewGuid().ToString("N");

            var messages = BuildChatMessages(root, logger);
            if (messages.Count == 0)
            {
                messages.Add(new ChatMessage(ChatRole.User, ""));
            }

            context.Response.StatusCode = StatusCodes.Status200OK;
            context.Response.Headers.ContentType = "text/event-stream";
            context.Response.Headers.CacheControl = "no-cache";
            context.Response.Headers.Connection = "keep-alive";

            await WriteEventAsync(context, new
            {
                threadId,
                runId,
                type = "RUN_STARTED",
            }, cancellationToken).ConfigureAwait(false);

            await foreach (var update in chatClient.GetStreamingResponseAsync(
                messages,
                new ChatOptions { Instructions = MultimodalAgentFactory.SystemPrompt },
                cancellationToken).ConfigureAwait(false))
            {
                var delta = ExtractText(update);
                if (string.IsNullOrEmpty(delta))
                {
                    continue;
                }

                if (!responseStarted)
                {
                    await WriteEventAsync(context, new
                    {
                        messageId,
                        role = "assistant",
                        type = "TEXT_MESSAGE_START",
                    }, cancellationToken).ConfigureAwait(false);
                    responseStarted = true;
                }

                await WriteEventAsync(context, new
                {
                    messageId,
                    delta,
                    type = "TEXT_MESSAGE_CONTENT",
                }, cancellationToken).ConfigureAwait(false);
            }

            if (!responseStarted)
            {
                await WriteEventAsync(context, new
                {
                    messageId,
                    role = "assistant",
                    type = "TEXT_MESSAGE_START",
                }, cancellationToken).ConfigureAwait(false);
            }

            await WriteEventAsync(context, new
            {
                messageId,
                type = "TEXT_MESSAGE_END",
            }, cancellationToken).ConfigureAwait(false);

            await WriteEventAsync(context, new
            {
                threadId,
                runId,
                result = (object?)null,
                type = "RUN_FINISHED",
            }, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "Multimodal endpoint failed.");
            if (!context.Response.HasStarted)
            {
                context.Response.StatusCode = StatusCodes.Status200OK;
                context.Response.Headers.ContentType = "text/event-stream";
                context.Response.Headers.CacheControl = "no-cache";
                context.Response.Headers.Connection = "keep-alive";
            }

            await WriteEventAsync(context, new
            {
                message = ex.Message,
                type = "RUN_ERROR",
            }, CancellationToken.None).ConfigureAwait(false);
        }
    }

    private static List<ChatMessage> BuildChatMessages(JsonElement root, ILogger logger)
    {
        var messages = new List<ChatMessage>();
        if (!root.TryGetProperty("messages", out var messageArray) ||
            messageArray.ValueKind != JsonValueKind.Array)
        {
            return messages;
        }

        foreach (var messageElement in messageArray.EnumerateArray())
        {
            var role = RoleFromString(GetString(messageElement, "role"));
            if (role is null)
            {
                continue;
            }

            if (!messageElement.TryGetProperty("content", out var contentElement))
            {
                messages.Add(new ChatMessage(role.Value, ""));
                continue;
            }

            if (contentElement.ValueKind == JsonValueKind.String)
            {
                messages.Add(new ChatMessage(role.Value, contentElement.GetString() ?? ""));
                continue;
            }

            if (contentElement.ValueKind != JsonValueKind.Array)
            {
                continue;
            }

            var contents = ContentPartsFromJson(contentElement, logger);
            if (contents.Count > 0)
            {
                messages.Add(new ChatMessage(role.Value, contents));
            }
        }

        return messages;
    }

    private static List<AIContent> ContentPartsFromJson(JsonElement contentArray, ILogger logger)
    {
        var contents = new List<AIContent>();
        var mediaKeys = new HashSet<string>(StringComparer.Ordinal);

        foreach (var part in contentArray.EnumerateArray())
        {
            if (part.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var type = GetString(part, "type");
            if (type == "text")
            {
                var text = GetString(part, "text");
                if (!string.IsNullOrEmpty(text))
                {
                    contents.Add(new TextContent(text));
                }
                continue;
            }

            if (TryCreateDataContent(part, mediaKeys, logger, out var dataContent))
            {
                contents.Add(dataContent);
            }
        }

        return contents;
    }

    private static bool TryCreateDataContent(
        JsonElement part,
        HashSet<string> mediaKeys,
        ILogger logger,
        out DataContent dataContent)
    {
        dataContent = null!;

        var mimeType =
            GetString(part, "mimeType") ??
            GetString(part, "mediaType") ??
            "application/octet-stream";

        if (part.TryGetProperty("source", out var source) &&
            source.ValueKind == JsonValueKind.Object)
        {
            mimeType =
                GetString(source, "mimeType") ??
                GetString(source, "mediaType") ??
                mimeType;

            var sourceType = GetString(source, "type");
            var value = GetString(source, "value") ?? GetString(source, "url");
            if (sourceType == "data" && !string.IsNullOrEmpty(value))
            {
                return TryCreateInlineDataContent(value, mimeType, mediaKeys, logger, out dataContent);
            }

            if (sourceType == "url" && !string.IsNullOrEmpty(value))
            {
                return TryCreateUriDataContent(value, mimeType, mediaKeys, out dataContent);
            }
        }

        var data = GetString(part, "data");
        if (!string.IsNullOrEmpty(data))
        {
            return TryCreateInlineDataContent(data, mimeType, mediaKeys, logger, out dataContent);
        }

        var url = GetString(part, "url");
        if (!string.IsNullOrEmpty(url))
        {
            return TryCreateUriDataContent(url, mimeType, mediaKeys, out dataContent);
        }

        return false;
    }

    private static bool TryCreateInlineDataContent(
        string rawValue,
        string mimeType,
        HashSet<string> mediaKeys,
        ILogger logger,
        out DataContent dataContent)
    {
        dataContent = null!;
        var payload = rawValue;
        var comma = rawValue.IndexOf(',');
        if (rawValue.StartsWith("data:", StringComparison.OrdinalIgnoreCase) && comma >= 0)
        {
            payload = rawValue[(comma + 1)..];
        }

        var key = $"{mimeType}:data:{payload}";
        if (!mediaKeys.Add(key))
        {
            return false;
        }

        try
        {
            dataContent = new DataContent(Convert.FromBase64String(payload), mimeType);
            return true;
        }
        catch (FormatException ex)
        {
            logger.LogWarning(ex, "Skipping multimodal attachment with invalid base64 payload.");
            return false;
        }
    }

    private static bool TryCreateUriDataContent(
        string uri,
        string mimeType,
        HashSet<string> mediaKeys,
        out DataContent dataContent)
    {
        dataContent = null!;
        var key = $"{mimeType}:uri:{uri}";
        if (!mediaKeys.Add(key))
        {
            return false;
        }

        dataContent = new DataContent(uri, mimeType);
        return true;
    }

    private static string ExtractText(ChatResponseUpdate update)
    {
        if (!string.IsNullOrEmpty(update.Text))
        {
            return update.Text;
        }

        if (update.Contents is null || update.Contents.Count == 0)
        {
            return "";
        }

        return string.Concat(update.Contents.OfType<TextContent>().Select(content => content.Text));
    }

    private static ChatRole? RoleFromString(string? role) =>
        role switch
        {
            "assistant" => ChatRole.Assistant,
            "system" => ChatRole.System,
            "tool" => ChatRole.Tool,
            "user" => ChatRole.User,
            _ => null,
        };

    private static string? GetString(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var value) ||
            value.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return value.GetString();
    }

    private static async Task WriteEventAsync(
        HttpContext context,
        object payload,
        CancellationToken cancellationToken)
    {
        var json = JsonSerializer.Serialize(payload, SseJsonOptions);
        await context.Response.WriteAsync($"data: {json}\n\n", cancellationToken).ConfigureAwait(false);
        await context.Response.Body.FlushAsync(cancellationToken).ConfigureAwait(false);
    }
}
