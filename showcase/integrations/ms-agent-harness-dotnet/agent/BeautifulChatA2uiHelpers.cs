using System.Text.Json;
using Microsoft.Extensions.Logging;

internal static class BeautifulChatA2ui
{
    internal static object BuildA2uiResponseFromContent(string? content, string errorId, ILogger logger)
    {
        ArgumentNullException.ThrowIfNull(errorId);
        ArgumentNullException.ThrowIfNull(logger);

        if (string.IsNullOrEmpty(content))
        {
            logger.LogError("GenerateA2ui (errorId={ErrorId}): content was null or empty", errorId);
            return StructuredError("empty_llm_output", "Model returned no text content", "Retry or check model availability", errorId);
        }

        JsonDocument? jsonDoc;
        try
        {
            jsonDoc = JsonDocument.Parse(content);
        }
        catch (JsonException ex)
        {
            logger.LogError(ex, "GenerateA2ui (errorId={ErrorId}): LLM returned malformed JSON", errorId);
            return StructuredError("malformed_llm_output", "The UI generator produced output that was not valid JSON.", "Ask the user to rephrase their request; the model sometimes adds explanatory text around the JSON.", errorId);
        }

        using (jsonDoc)
        {
            try
            {
                var args = jsonDoc.RootElement;
                if (args.ValueKind != JsonValueKind.Object)
                {
                    logger.LogError("GenerateA2ui (errorId={ErrorId}): LLM output was JSON but not an object (kind={Kind})", errorId, args.ValueKind);
                    return StructuredError("malformed_llm_output", "The UI generator output was JSON but not the expected object shape.", "Retry or adjust the prompt.", errorId);
                }

                var surfaceId = args.TryGetProperty("surfaceId", out var sid)
                    ? sid.GetString() ?? "dynamic-surface"
                    : "dynamic-surface";
                var catalogId = args.TryGetProperty("catalogId", out var cid)
                    ? cid.GetString() ?? "copilotkit://app-dashboard-catalog"
                    : "copilotkit://app-dashboard-catalog";

                if (!args.TryGetProperty("components", out var componentsElement) ||
                    componentsElement.ValueKind != JsonValueKind.Array)
                {
                    logger.LogError("GenerateA2ui (errorId={ErrorId}): LLM output missing 'components' array", errorId);
                    return StructuredError("malformed_llm_output", "The UI generator output did not include a components array.", "Retry the request.", errorId);
                }

                var operations = new List<object>
                {
                    new { version = "v0.9", createSurface = new { surfaceId, catalogId } },
                    new
                    {
                        version = "v0.9",
                        updateComponents = new
                        {
                            surfaceId,
                            components = JsonSerializer.Deserialize<object[]>(componentsElement.GetRawText()),
                        },
                    },
                };

                if (args.TryGetProperty("data", out var dataElement) && dataElement.ValueKind != JsonValueKind.Null)
                {
                    operations.Add(new
                    {
                        version = "v0.9",
                        updateDataModel = new
                        {
                            surfaceId,
                            path = "/",
                            value = JsonSerializer.Deserialize<object>(dataElement.GetRawText()),
                        },
                    });
                }

                return new { a2ui_operations = operations };
            }
            catch (JsonException ex)
            {
                logger.LogError(ex, "GenerateA2ui (errorId={ErrorId}): shape deserialization failed", errorId);
                return StructuredError("malformed_llm_output", "The UI generator output did not match the expected structure.", "Retry the request.", errorId);
            }
            catch (ArgumentException ex)
            {
                logger.LogError(ex, "GenerateA2ui (errorId={ErrorId}): argument validation failed", errorId);
                return StructuredError("invalid_argument", "One of the arguments was invalid.", "Check the request shape and retry.", errorId);
            }
        }
    }

    internal static object StructuredError(string category, string message, string remediation, string errorId) =>
        new
        {
            error = category,
            message,
            remediation,
            errorId,
        };
}
