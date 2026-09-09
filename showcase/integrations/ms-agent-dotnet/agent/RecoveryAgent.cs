using System.Net.Http;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

// =============================================================================
// A2UI Error Recovery agent (a2ui-recovery) — ms-agent-dotnet backend.
// =============================================================================
//
// Mirrors the LangGraph reference `src/agents/recovery_agent.py`: run a
// secondary "render" planner, VALIDATE the produced A2UI surface against the
// declarative-gen-ui catalog's structural rules, RETRY on validation failure up
// to `MaxAttempts`, and — when every attempt is invalid — surface the
// `a2ui_recovery_exhausted` HARD-FAIL as the renderer's `status: "failed"`
// lifecycle card ("Couldn't generate the UI"). A single healed attempt paints
// the declarative surface.
//
// -----------------------------------------------------------------------------
// WHY A RAW-SSE ENDPOINT (MapPost) INSTEAD OF A ChatClientAgent + MapAGUI
// -----------------------------------------------------------------------------
// The recovery-exhausted FAILURE card is rendered by `@copilotkit/react-core`'s
// `A2UIRecoveryStates` ONLY when the `a2ui-surface` activity content carries
// `status: "failed"` (see packages/react-core/src/v2/a2ui/A2UIMessageRenderer.tsx
// -> renderLifecycle). On this repo's client stack (`@ag-ui/a2ui-middleware@0.0.5`)
// that middleware NEVER stamps `status` — it only synthesises `a2ui-surface`
// activities from a tool result's `a2ui_operations`. So a `status: "failed"`
// surface can only reach the client as a BACKEND-emitted AG-UI `ACTIVITY_SNAPSHOT`
// event (activityType `a2ui-surface`), exactly as LangGraph's `get_a2ui_tools`
// emits it in-graph.
//
// The Microsoft Agent Framework AG-UI ASP.NET adapter (`MapAGUI`) maps only a
// fixed set of `Microsoft.Extensions.AI` content types to AG-UI events
// (TextContent -> TEXT_MESSAGE_*, TextReasoningContent -> REASONING_MESSAGE_*,
// DataContent[application/json] -> STATE_SNAPSHOT, Function*Content ->
// TOOL_CALL_*). There is NO content type or API to emit a raw `ACTIVITY_SNAPSHOT`
// with a custom `activityType` from inside a `MapAGUI`-mounted `AIAgent`. The
// heal (success) path could be done through a normal tool result — but the
// exhaust (hard-fail) path cannot. Rather than split the demo across two
// mechanisms (or fake the failure card with catalog components), this agent
// hand-writes the AG-UI SSE stream, the SAME adapter-bypass pattern the repo
// already uses for the multimodal demo (see agent/MultimodalEndpoint.cs).
//
// It still REUSES `A2uiSecondaryToolCaller` for the secondary render call, so
// the aimock keying is identical to the declarative-gen-ui demo: inner tool
// `_design_a2ui_surface`, keyed by the forwarded user message + sequenceIndex
// (0 invalid -> 1 valid drives the heal retry) + the `x-aimock-context` slug.
//
// Mount (raw SSE; NOT MapAGUI):
//   app.MapPost("/a2ui-recovery", (HttpContext ctx) =>
//       RecoveryAgent.HandleAsync(ctx, builder.Configuration,
//           loggerFactory.CreateLogger("RecoveryAgent")));
// =============================================================================

internal static class RecoveryAgent
{
    /// <summary>Recovery attempt cap. Mirrors the reference's
    /// <c>recovery: {maxAttempts: 3}</c>.</summary>
    private const int MaxAttempts = 3;

    /// <summary>Catalog reused from the declarative-gen-ui demo (no new
    /// components introduced). Healed surfaces are stamped with this id.</summary>
    private const string DefaultCatalogId = "declarative-gen-ui-catalog";

    private const string DefaultSurfaceId = "recovery-surface";

    /// <summary>System prompt for the secondary render planner. Its content does
    /// NOT affect aimock matching (fixtures key on the user message + tool name +
    /// sequenceIndex + context), but a faithful prompt keeps a live/non-mock run
    /// coherent.</summary>
    private const string RenderSystemPrompt =
        "You are an A2UI render planner for the Vantage Threads sales analyst. " +
        "Produce a single A2UI v0.9 surface (flat component array, root id \"root\") " +
        "using ONLY the declarative-gen-ui catalog components " +
        "(Card, Column, Row, Text, Metric, PieChart, BarChart, DataTable, StatusBadge, " +
        "InfoRow, PrimaryButton). Every referenced child id MUST be defined. " +
        "Use catalogId='declarative-gen-ui-catalog'.";

    private static readonly JsonSerializerOptions SseJsonOptions = new(JsonSerializerDefaults.Web);

    public static async Task HandleAsync(
        HttpContext context,
        IConfiguration configuration,
        ILogger logger)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(logger);

        var cancellationToken = context.RequestAborted;
        var threadId = "";
        var runId = "";
        var errorId = Guid.NewGuid().ToString("n")[..16];

        try
        {
            using var body = await JsonDocument.ParseAsync(
                context.Request.Body,
                cancellationToken: cancellationToken).ConfigureAwait(false);
            var root = body.RootElement;

            threadId = GetString(root, "threadId") ?? "";
            runId = GetString(root, "runId") ?? Guid.NewGuid().ToString("N");
            var userContent = ExtractLastUserText(root);

            StartSse(context);
            await WriteEventAsync(context, new
            {
                threadId,
                runId,
                type = "RUN_STARTED",
            }, cancellationToken).ConfigureAwait(false);

            var attempts = new List<object>();
            RecoveryOutcome? healed = null;

            for (var attempt = 1; attempt <= MaxAttempts && healed is null; attempt++)
            {
                string? args;
                try
                {
                    // Reuse the declarative demo's secondary caller: forces the
                    // `_design_a2ui_surface` tool and forwards x-aimock-context.
                    // Sending the SAME userContent each attempt lets aimock advance
                    // sequenceIndex (0 invalid -> 1 valid) to drive the heal retry.
                    args = await A2uiSecondaryToolCaller.GetDesignToolArgumentsAsync(
                        configuration,
                        RenderSystemPrompt,
                        userContent,
                        cancellationToken).ConfigureAwait(false);
                }
                catch (HttpRequestException ex)
                {
                    // Transport / non-2xx upstream. Not a validation failure — do
                    // not keep retrying an environmental error; treat as a hard
                    // fail and surface the recovery card.
                    logger.LogError(ex, "RecoveryAgent (errorId={ErrorId}): secondary render upstream failure on attempt {Attempt}", errorId, attempt);
                    attempts.Add(new { attempt, ok = false, errors = new[] { "upstream_error" } });
                    break;
                }
                catch (A2uiUpstreamResponseException ex)
                {
                    logger.LogError(ex, "RecoveryAgent (errorId={ErrorId}): secondary render malformed upstream body on attempt {Attempt}: {Body}", errorId, attempt, ex.Body);
                    attempts.Add(new { attempt, ok = false, errors = new[] { "upstream_malformed" } });
                    break;
                }

                var result = TryBuildValidatedSurface(args);
                LogAttempt(logger, errorId, attempt, result.Ok, result.Errors);
                attempts.Add(new { attempt, ok = result.Ok, errors = result.Errors });

                if (result.Ok)
                {
                    healed = result;
                }
            }

            if (healed is { } surface)
            {
                // Heal: paint the validated declarative surface. Emitting the
                // a2ui_operations directly on the a2ui-surface activity is
                // equivalent to what the client middleware would synthesise from
                // a tool result — but here we own the stream end-to-end.
                await WriteEventAsync(context, new
                {
                    messageId = $"a2ui-surface-{surface.SurfaceId}-{runId}",
                    activityType = "a2ui-surface",
                    content = new Dictionary<string, object?>
                    {
                        ["a2ui_operations"] = surface.Operations,
                    },
                    replace = true,
                    type = "ACTIVITY_SNAPSHOT",
                }, cancellationToken).ConfigureAwait(false);

                await WriteNarrationAsync(
                    context,
                    "The first render came back malformed — I recovered and painted your dashboard.",
                    cancellationToken).ConfigureAwait(false);
            }
            else
            {
                // Exhausted: emit the recovery-exhausted hard-fail as the
                // `status: "failed"` lifecycle card (react-core A2UIRecoveryFailure
                // -> "Couldn't generate the UI"). No a2ui_operations => no surface
                // paints (the server-side no-wipe guarantee).
                await WriteEventAsync(context, new
                {
                    messageId = $"a2ui-surface-recovery-fail-{runId}",
                    activityType = "a2ui-surface",
                    content = new Dictionary<string, object?>
                    {
                        ["status"] = "failed",
                        ["error"] = "a2ui_recovery_exhausted",
                        ["attempts"] = attempts,
                        ["maxAttempts"] = MaxAttempts,
                    },
                    replace = true,
                    type = "ACTIVITY_SNAPSHOT",
                }, cancellationToken).ConfigureAwait(false);

                await WriteNarrationAsync(
                    context,
                    "I couldn't produce a valid surface after several attempts — showing a graceful fallback instead.",
                    cancellationToken).ConfigureAwait(false);
            }

            await WriteEventAsync(context, new
            {
                threadId,
                runId,
                result = (object?)null,
                type = "RUN_FINISHED",
            }, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            logger.LogInformation("RecoveryAgent (errorId={ErrorId}): request cancelled", errorId);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "RecoveryAgent (errorId={ErrorId}): unhandled failure", errorId);
            if (!context.Response.HasStarted)
            {
                StartSse(context);
            }

            await WriteEventAsync(context, new
            {
                message = "The recovery agent encountered an internal error.",
                type = "RUN_ERROR",
            }, CancellationToken.None).ConfigureAwait(false);
        }
    }

    /// <summary>Outcome of a single validated render attempt.</summary>
    private sealed record RecoveryOutcome(bool Ok, string[] Errors, string SurfaceId, List<object> Operations);

    /// <summary>
    /// Parse the secondary planner's <c>_design_a2ui_surface</c> arguments,
    /// structurally validate the component tree against the declarative catalog's
    /// rules (root present + every static child reference resolves), and — on
    /// success — build the <c>a2ui_operations</c> envelope
    /// (createSurface -> updateComponents -> optional updateDataModel).
    /// </summary>
    private static RecoveryOutcome TryBuildValidatedSurface(string? args)
    {
        if (string.IsNullOrWhiteSpace(args))
        {
            return new RecoveryOutcome(false, new[] { "empty_render_output" }, DefaultSurfaceId, new());
        }

        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(args);
        }
        catch (JsonException)
        {
            return new RecoveryOutcome(false, new[] { "malformed_render_json" }, DefaultSurfaceId, new());
        }

        using (doc)
        {
            var rootEl = doc.RootElement;
            if (rootEl.ValueKind != JsonValueKind.Object)
            {
                return new RecoveryOutcome(false, new[] { "render_output_not_object" }, DefaultSurfaceId, new());
            }

            var surfaceId = GetString(rootEl, "surfaceId") ?? DefaultSurfaceId;
            var catalogId = GetString(rootEl, "catalogId") ?? DefaultCatalogId;

            if (!rootEl.TryGetProperty("components", out var componentsEl) ||
                componentsEl.ValueKind != JsonValueKind.Array)
            {
                return new RecoveryOutcome(false, new[] { "missing_components_array" }, surfaceId, new());
            }

            var errors = ValidateComponents(componentsEl);
            if (errors.Count > 0)
            {
                return new RecoveryOutcome(false, errors.ToArray(), surfaceId, new());
            }

            // Detach the JSON from the document so it stays valid after dispose.
            var components = componentsEl.Clone();
            JsonElement? data = rootEl.TryGetProperty("data", out var dataEl) &&
                                dataEl.ValueKind != JsonValueKind.Null
                ? dataEl.Clone()
                : null;

            var ops = new List<object>
            {
                new { version = "v0.9", createSurface = new { surfaceId, catalogId } },
                new { version = "v0.9", updateComponents = new { surfaceId, components } },
            };
            if (data is { } d)
            {
                ops.Add(new { version = "v0.9", updateDataModel = new { surfaceId, path = "/", value = d } });
            }

            return new RecoveryOutcome(true, Array.Empty<string>(), surfaceId, ops);
        }
    }

    /// <summary>
    /// Structural validation mirroring the reference's <c>_a2ui_utils</c> +
    /// catalog schema check: sanitize entries missing <c>id</c>/<c>component</c>,
    /// require a <c>root</c> component, and reject any component whose static
    /// child reference (the <c>child</c> string, or a string entry in a
    /// <c>children</c> array) does not resolve to a defined id. Data-bound
    /// <c>children</c> objects (<c>{ componentId, path }</c>) are templates and
    /// are skipped. A dangling reference (as in the aimock invalid fixtures where
    /// root points at a missing child) fails validation and drives a retry.
    /// </summary>
    private static List<string> ValidateComponents(JsonElement componentsEl)
    {
        var errors = new List<string>();
        var defined = new HashSet<string>(StringComparer.Ordinal);
        var hasRoot = false;

        foreach (var component in componentsEl.EnumerateArray())
        {
            if (component.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var id = GetString(component, "id");
            var kind = GetString(component, "component");
            if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(kind))
            {
                // Sanitize: the renderer rejects entries missing id/component.
                continue;
            }

            defined.Add(id);
            if (id == "root")
            {
                hasRoot = true;
            }
        }

        if (!hasRoot)
        {
            errors.Add("missing_root_component");
        }

        foreach (var component in componentsEl.EnumerateArray())
        {
            if (component.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            if (component.TryGetProperty("child", out var childEl) &&
                childEl.ValueKind == JsonValueKind.String)
            {
                var reference = childEl.GetString();
                if (!string.IsNullOrEmpty(reference) && !defined.Contains(reference))
                {
                    errors.Add($"dangling_child_reference:{reference}");
                }
            }

            if (component.TryGetProperty("children", out var childrenEl) &&
                childrenEl.ValueKind == JsonValueKind.Array)
            {
                foreach (var child in childrenEl.EnumerateArray())
                {
                    if (child.ValueKind != JsonValueKind.String)
                    {
                        // Data-bound / object children are templates, not static refs.
                        continue;
                    }

                    var reference = child.GetString();
                    if (!string.IsNullOrEmpty(reference) && !defined.Contains(reference))
                    {
                        errors.Add($"dangling_child_reference:{reference}");
                    }
                }
            }
        }

        return errors;
    }

    private static void LogAttempt(ILogger logger, string errorId, int attempt, bool ok, string[] errors)
    {
        // Dev observability: mirror recovery_agent.py's `_log_attempt` — log every
        // attempt (incl. rejected ones) with its validation errors.
        logger.LogInformation(
            "[a2ui recovery] (errorId={ErrorId}) attempt {Attempt}: {Result} {Errors}",
            errorId,
            attempt,
            ok ? "valid" : "invalid",
            errors.Length == 0 ? "[]" : string.Join(", ", errors));
    }

    private static async Task WriteNarrationAsync(HttpContext context, string text, CancellationToken cancellationToken)
    {
        var messageId = $"msg_{Guid.NewGuid():N}";
        await WriteEventAsync(context, new
        {
            messageId,
            role = "assistant",
            type = "TEXT_MESSAGE_START",
        }, cancellationToken).ConfigureAwait(false);

        await WriteEventAsync(context, new
        {
            messageId,
            delta = text,
            type = "TEXT_MESSAGE_CONTENT",
        }, cancellationToken).ConfigureAwait(false);

        await WriteEventAsync(context, new
        {
            messageId,
            type = "TEXT_MESSAGE_END",
        }, cancellationToken).ConfigureAwait(false);
    }

    private static void StartSse(HttpContext context)
    {
        context.Response.StatusCode = StatusCodes.Status200OK;
        context.Response.Headers.ContentType = "text/event-stream";
        context.Response.Headers.CacheControl = "no-cache";
        context.Response.Headers.Connection = "keep-alive";
    }

    private static async Task WriteEventAsync(HttpContext context, object payload, CancellationToken cancellationToken)
    {
        var json = JsonSerializer.Serialize(payload, SseJsonOptions);
        await context.Response.WriteAsync($"data: {json}\n\n", cancellationToken).ConfigureAwait(false);
        await context.Response.Body.FlushAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Extract the last user message's text. AG-UI messages carry either
    /// a plain string <c>content</c> or an array of typed parts.</summary>
    private static string ExtractLastUserText(JsonElement root)
    {
        if (!root.TryGetProperty("messages", out var messages) ||
            messages.ValueKind != JsonValueKind.Array)
        {
            return "";
        }

        string? last = null;
        foreach (var message in messages.EnumerateArray())
        {
            if (message.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            if (!string.Equals(GetString(message, "role"), "user", StringComparison.Ordinal))
            {
                continue;
            }

            if (!message.TryGetProperty("content", out var content))
            {
                continue;
            }

            if (content.ValueKind == JsonValueKind.String)
            {
                last = content.GetString();
            }
            else if (content.ValueKind == JsonValueKind.Array)
            {
                var text = string.Concat(
                    content.EnumerateArray()
                        .Where(p => p.ValueKind == JsonValueKind.Object &&
                                    string.Equals(GetString(p, "type"), "text", StringComparison.Ordinal))
                        .Select(p => GetString(p, "text") ?? ""));
                if (!string.IsNullOrEmpty(text))
                {
                    last = text;
                }
            }
        }

        return last ?? "";
    }

    private static string? GetString(JsonElement element, string propertyName) =>
        element.TryGetProperty(propertyName, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
}
