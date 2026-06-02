using System.ClientModel;
using System.ComponentModel;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using OpenAI;

namespace MsAgentHarnessControlRoom.Agent;

/// <summary>
/// Builds the Control Room agent on top of the Microsoft Agent Harness, wired to
/// OpenAI's Responses API. Harness pre-configures the AgentMode, Todo,
/// FileAccess, FileMemory, ToolApproval, and AgentSkills providers — so this
/// factory supplies the chat client, workspace-oriented instructions, and one
/// approval-gated `pnpm_run` workspace command tool.
/// </summary>
internal sealed class ControlRoomAgentFactory
{
    private const string AgentName = "control_room_agent";
    private const string DefaultModelId = "gpt-5.4";
    private const int MaxContextWindowTokens = 200_000;
    private const int MaxOutputTokens = 16_000;

    private readonly IConfiguration _configuration;

    internal ControlRoomAgentFactory(IConfiguration configuration)
    {
        _configuration = configuration;
    }

    public AIAgent CreateControlRoomAgent()
    {
        var apiKey = _configuration["OPENAI_API_KEY"]
            ?? Environment.GetEnvironmentVariable("OPENAI_API_KEY")
            ?? throw new InvalidOperationException(
                "OPENAI_API_KEY not found. Set it in .env at the example root " +
                "(see .env.example) so docker compose injects it into the agent container.");

        var modelId = _configuration["OPENAI_MODEL_ID"]
            ?? Environment.GetEnvironmentVariable("OPENAI_MODEL_ID")
            ?? DefaultModelId;

        // Use OpenAI's public Responses API directly — Wesley's Harness samples
        // funnel through Azure AI Foundry, but Harness's IChatClient pipeline is
        // provider-agnostic and the user's key already speaks gpt-5.x via /v1/responses.
        var openAiClient = new OpenAIClient(new ApiKeyCredential(apiKey));

        // Wrap the chat client so AG-UI `forwardedProps.responseFormat`
        // directives from the frontend are promoted into per-call
        // `ChatOptions.ResponseFormat`. See
        // `docs/superpowers/investigations/2026-05-26-structured-output-on-demand.md`
        // for why this glue lives in the app rather than upstream MAF.
        IChatClient chatClient = new ForwardedPropsResponseFormatPromoter(
            openAiClient.GetResponsesClient().AsIChatClient(modelId));

        // The demo workspace lives in the container's writable layer; Harness's
        // FileMemoryProvider gets its own subdirectory so memory survives
        // separately from the working repo.
        var fixtureRoot = ResolveFixtureRoot();
        var memoryRoot = Path.Combine(AppContext.BaseDirectory, "agent-files");
        Directory.CreateDirectory(memoryRoot);

        // Harness's `ShellExecutor` is intentionally null in this build —
        // see docs/superpowers/gap-analysis/2026-05-26-ag-ui-harness-gap.md
        // for why. To keep the demo runnable end-to-end we register a single
        // narrow AIFunction that runs approved workspace pnpm scripts inside
        // the container. The function is registered on ChatOptions.Tools, so
        // the agent invokes it like any tool call; Harness's ToolApproval
        // wrapper still gates it.
        var pnpmTool = AIFunctionFactory.Create(
            (string command, CancellationToken ct) => RunPnpmCommand(fixtureRoot, command, ct),
            new AIFunctionFactoryOptions
            {
                Name = "pnpm_run",
                Description =
                    "Run one approved pnpm command inside the demo workspace: " +
                    "install, test, test:coverage, typecheck, or data:summary. Returns exit code + stdout + stderr.",
            });

        // Gate every pnpm_run invocation through Harness's ToolApprovalAgent.
        // The wrapper makes the function emit a ToolApprovalRequestContent on
        // each call; our ApprovalContentWireBridge converts that into a
        // synthetic `request_approval` tool call so it crosses the
        // AG-UI wire and a Harness approval card renders in the cockpit.
        var gatedPnpmTool = new ApprovalRequiredAIFunction(pnpmTool);
        var a2uiTool = AIFunctionFactory.Create(
            RenderA2UI,
            new AIFunctionFactoryOptions
            {
                Name = "render_control_room_a2ui",
                Description =
                    "Render one composed A2UI surface from the local dynamic catalog as the final display action. " +
                    "Pass a flat components array with root id 'root'; containers reference child ids via children arrays. " +
                    "Use this for dashboards, charts, forms, tables, and cards. Returns A2UI operations for the local catalog.",
            });

        var harnessAgent = chatClient.AsHarnessAgent(
            MaxContextWindowTokens,
            MaxOutputTokens,
            new HarnessAgentOptions
            {
                Name = AgentName,
                Description =
                    "Control Room agent — answers workspace questions, reads code and data, plans work, " +
                    "and uses HITL-approved commands when execution is requested.",
                // Sandbox file access to the fixture root. FileAccessProvider rejects
                // reads and writes outside this directory.
                FileAccessStore = new FileSystemAgentFileStore(fixtureRoot),
                // File memory lives in a separate directory so it survives
                // fixture resets and the agent can carry forward notes across
                // sessions.
                FileMemoryStore = new FileSystemAgentFileStore(memoryRoot),
                ChatOptions = new ChatOptions
                {
                    Instructions = BuildInstructions(),
                    // Keep stage-demo tool flow legible and prevent frontend
                    // display components from being batched with pending
                    // Harness tool calls.
                    AllowMultipleToolCalls = false,
                    MaxOutputTokens = MaxOutputTokens,
                    Tools = [gatedPnpmTool, a2uiTool],
                },
            });

        // Outermost wrapper: app-owned content-bridge that converts
        // ToolApprovalRequestContent ↔ a synthetic `request_approval`
        // function-call so the AG-UI wire (which only serialises function-
        // calls + text) can carry the approval flow end-to-end.
        return new ApprovalContentWireBridge(harnessAgent);
    }

    /// <summary>
    /// Runs one approved pnpm command (`install`, `test`, `test:coverage`,
    /// `typecheck`, `data:summary`) in the fixture working directory, with a
    /// hard timeout and stdout/stderr captured. Harness's ToolApproval wrapper
    /// fires the approval gate before this is invoked.
    /// </summary>
    private static async Task<PnpmCommandResult> RunPnpmCommand(
        string fixtureRoot,
        [Description("One of: install | test | test:coverage | typecheck | data:summary")] string command,
        CancellationToken cancellationToken)
    {
        if (command is not ("install" or "test" or "test:coverage" or "typecheck" or "data:summary"))
        {
            return new PnpmCommandResult(
                Command: command,
                ExitCode: -1,
                TimedOut: false,
                Stdout: "",
                Stderr: $"Refusing to run '{command}'. Allowed: install, test, test:coverage, typecheck, data:summary.");
        }

        var psi = new ProcessStartInfo
        {
            FileName = "pnpm",
            WorkingDirectory = fixtureRoot,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        // `install` is a bare verb in pnpm; the others are npm-scripts under `run`.
        if (command == "install")
        {
            psi.ArgumentList.Add("install");
        }
        else
        {
            psi.ArgumentList.Add("run");
            psi.ArgumentList.Add(command);
        }

        using var process = new Process { StartInfo = psi };
        var stdout = new StringBuilder();
        var stderr = new StringBuilder();
        process.OutputDataReceived += (_, e) => { if (e.Data is not null) stdout.AppendLine(e.Data); };
        process.ErrorDataReceived += (_, e) => { if (e.Data is not null) stderr.AppendLine(e.Data); };

        if (!process.Start())
        {
            return new PnpmCommandResult(command, -1, false, "", "Failed to start pnpm process.");
        }
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(TimeSpan.FromMinutes(3));

        var timedOut = false;
        try
        {
            await process.WaitForExitAsync(timeoutCts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            timedOut = true;
            try { process.Kill(entireProcessTree: true); } catch { /* best effort */ }
            await process.WaitForExitAsync(CancellationToken.None).ConfigureAwait(false);
        }

        return new PnpmCommandResult(
            Command: command,
            ExitCode: timedOut ? -1 : process.ExitCode,
            TimedOut: timedOut,
            Stdout: Truncate(stdout.ToString()),
            Stderr: Truncate(stderr.ToString()));
    }

    private const int MaxOutputCharacters = 12_000;
    private static string Truncate(string text) =>
        text.Length <= MaxOutputCharacters
            ? text
            : text[..(MaxOutputCharacters - 32)] + "\n...[truncated to 12000 chars]";

    internal sealed record PnpmCommandResult(
        string Command,
        int ExitCode,
        bool TimedOut,
        string Stdout,
        string Stderr);

    private const string A2UICatalogId = "copilotkit://ms-agent-harness-control-room";

    private static string RenderA2UI(
        [Description(
            "Flat A2UI v0.9 component array. Every item needs id and component. " +
            "The root item must have id 'root'. Container components such as Surface, Card, Row, and Column reference child ids with children. " +
            "Use catalog components: Surface, SectionHeader, Card, Metric, Badge, Button, TextInput, Textarea, Select, Checkbox, Switch, Progress, BarChart, LineChart, AreaChart, StackedAreaChart, DonutChart, RadarChart, RadialChart, Calendar, RunHealthTable, FileImpactMap, ApprovalForm, HandoffForm. Basic Row and Column are also available.")]
        List<A2UIComponentNode>? components = null,
        [Description("Optional short surface title used only if components is omitted.")]
        string? title = null,
        [Description("Optional supporting sentence used only if components is omitted.")]
        string? description = null,
        [Description("Deprecated simple component name. Prefer components. Kept for older prompts.")]
        string? component = null,
        [Description("Metrics used only for deprecated simple Card calls.")]
        List<A2UIMetric>? metrics = null,
        [Description("Chart data used only for deprecated simple chart calls.")]
        List<A2UIDataPoint>? data = null)
    {
        var normalizedComponents = components is { Count: > 0 }
            ? NormalizeA2UIComponents(components)
            : BuildFallbackA2UIComponents(title, description, component, metrics, data);

        if (!normalizedComponents.Any(c => c.TryGetValue("id", out var id) && id as string == "root"))
        {
            return JsonSerializer.Serialize(
                new
                {
                    error = "A2UI components must include a root node with id 'root'."
                },
                A2UIJsonOptions);
        }

        var invalidComponent = normalizedComponents
            .Select(c => c.TryGetValue("component", out var name) ? name as string : null)
            .FirstOrDefault(name => string.IsNullOrWhiteSpace(name) || !SupportedA2UIComponents.Contains(name));

        if (!string.IsNullOrWhiteSpace(invalidComponent))
        {
            return JsonSerializer.Serialize(
                new
                {
                    error = $"Unsupported A2UI component '{invalidComponent}'. Use one of: {string.Join(", ", SupportedA2UIComponents)}."
                },
                A2UIJsonOptions);
        }

        var surfaceId = $"control-room-a2ui-{Guid.NewGuid():N}";
        var operations = new object[]
        {
            new Dictionary<string, object?>
            {
                ["version"] = "v0.9",
                ["createSurface"] = new Dictionary<string, object?>
                {
                    ["surfaceId"] = surfaceId,
                    ["catalogId"] = A2UICatalogId,
                },
            },
            new Dictionary<string, object?>
            {
                ["version"] = "v0.9",
                ["updateComponents"] = new Dictionary<string, object?>
                {
                    ["surfaceId"] = surfaceId,
                    ["components"] = normalizedComponents,
                },
            },
        };

        return JsonSerializer.Serialize(
            new Dictionary<string, object?> { ["a2ui_operations"] = operations },
            A2UIJsonOptions);
    }

    private static readonly HashSet<string> SupportedA2UIComponents = new(StringComparer.Ordinal)
    {
        "Surface",
        "SectionHeader",
        "Card",
        "Metric",
        "Badge",
        "Button",
        "TextInput",
        "Textarea",
        "Select",
        "Checkbox",
        "Switch",
        "Progress",
        "BarChart",
        "LineChart",
        "AreaChart",
        "StackedAreaChart",
        "DonutChart",
        "RadarChart",
        "RadialChart",
        "Calendar",
        "RunHealthTable",
        "FileImpactMap",
        "ApprovalForm",
        "HandoffForm",
        "Row",
        "Column",
        // Backwards-compatible aliases from the previous catalog.
        "StatusBadge",
        "PrimaryButton",
        "PieChart",
        "InfoRow",
    };

    private static readonly JsonSerializerOptions A2UIJsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private static List<Dictionary<string, object?>> NormalizeA2UIComponents(List<A2UIComponentNode> nodes)
    {
        var seenIds = new HashSet<string>(StringComparer.Ordinal);
        var normalized = new List<Dictionary<string, object?>>();

        foreach (var node in nodes)
        {
            if (string.IsNullOrWhiteSpace(node.Id) || !seenIds.Add(node.Id))
            {
                continue;
            }

            normalized.Add(ToA2UIComponent(node));
        }

        return normalized;
    }

    private static Dictionary<string, object?> ToA2UIComponent(A2UIComponentNode node)
    {
        var component = NormalizeComponentName(node.Component);
        var item = new Dictionary<string, object?>
        {
            ["id"] = node.Id,
            ["component"] = component,
        };

        AddIfPresent(item, "title", node.Title);
        AddIfPresent(item, "subtitle", node.Subtitle);
        AddIfPresent(item, "description", node.Description);
        AddIfPresent(item, "summary", node.Summary);
        AddIfPresent(item, "eyebrow", node.Eyebrow);
        AddIfPresent(item, "badge", node.Badge);
        AddIfPresent(item, "label", node.Label);
        AddIfPresent(item, "value", component == "Progress" ? node.NumericValue : node.Value);
        AddIfPresent(item, "detail", node.Detail);
        AddIfPresent(item, "trend", NormalizeTrend(node.Trend));
        AddIfPresent(item, "tone", node.Tone);
        AddIfPresent(item, "text", node.Text ?? node.Label);
        AddIfPresent(item, "variant", NormalizeVariant(node.Variant));
        AddIfPresent(item, "checked", node.Checked);
        AddIfPresent(item, "placeholder", node.Placeholder);
        AddIfPresent(item, "owner", node.Owner);
        AddIfPresent(item, "notes", node.Notes);
        AddIfPresent(item, "command", node.Command);
        AddIfPresent(item, "risk", NormalizeRisk(node.Risk));
        AddIfPresent(item, "options", node.Options);
        AddIfPresent(item, "data", node.Data);
        AddIfPresent(item, "metrics", node.Metrics);
        AddIfPresent(item, "rows", node.Rows);
        AddIfPresent(item, "events", node.Events);
        AddIfPresent(item, "files", node.Files);
        AddIfPresent(item, "checks", node.Checks);
        AddIfPresent(item, "followups", node.Followups);

        var childIds = node.Children is { Count: > 0 }
            ? node.Children
            : string.IsNullOrWhiteSpace(node.Child)
                ? null
                : new List<string> { node.Child };
        AddIfPresent(item, "children", childIds);

        return item;
    }

    private static List<Dictionary<string, object?>> BuildFallbackA2UIComponents(
        string? title,
        string? description,
        string? component,
        List<A2UIMetric>? metrics,
        List<A2UIDataPoint>? data)
    {
        var requestedComponent = NormalizeComponentName(component ?? "Surface");

        if (requestedComponent is "BarChart" or "AreaChart" or "LineChart" or "DonutChart")
        {
            return
            [
                new()
                {
                    ["id"] = "root",
                    ["component"] = "Surface",
                    ["title"] = string.IsNullOrWhiteSpace(title) ? "A2UI Chart" : title,
                    ["subtitle"] = description,
                    ["children"] = new List<string> { "chart-card" },
                },
                new()
                {
                    ["id"] = "chart-card",
                    ["component"] = "Card",
                    ["title"] = string.IsNullOrWhiteSpace(title) ? requestedComponent : title,
                    ["description"] = description,
                    ["children"] = new List<string> { "chart" },
                },
                new()
                {
                    ["id"] = "chart",
                    ["component"] = requestedComponent,
                    ["data"] = data is { Count: > 0 }
                        ? data
                        : new List<A2UIDataPoint>
                        {
                            new(Label: "Plan", Value: 34, Secondary: 16),
                            new(Label: "Build", Value: 58, Secondary: 28),
                            new(Label: "Verify", Value: 82, Secondary: 44),
                        },
                },
            ];
        }

        var metricItems = metrics is { Count: > 0 }
            ? metrics
            : new List<A2UIMetric>
            {
                new("Planned", "34%", "Requirements and catalog ready", "up", "default"),
                new("Built", "58%", "Composable nodes emitted", "up", "success"),
                new("Verified", "82%", "Renderer path active", "up", "success"),
            };

        var fallback = new List<Dictionary<string, object?>>
        {
            new()
            {
                ["id"] = "root",
                ["component"] = "Surface",
                ["title"] = string.IsNullOrWhiteSpace(title) ? "Progress Dashboard" : title,
                ["subtitle"] = string.IsNullOrWhiteSpace(description)
                    ? "Composed in one A2UI generation from catalog components."
                    : description,
                ["children"] = new List<string> { "metrics-row", "charts-row" },
            },
            new()
            {
                ["id"] = "metrics-row",
                ["component"] = "Row",
                ["children"] = metricItems.Select((_, index) => $"metric-{index + 1}").ToList(),
            },
        };

        for (var i = 0; i < metricItems.Count; i++)
        {
            fallback.Add(new Dictionary<string, object?>
            {
                ["id"] = $"metric-{i + 1}",
                ["component"] = "Metric",
                ["label"] = metricItems[i].Label,
                ["value"] = metricItems[i].Value,
                ["detail"] = metricItems[i].Detail,
                ["trend"] = NormalizeTrend(metricItems[i].Trend),
                ["tone"] = metricItems[i].Tone,
            });
        }

        fallback.AddRange(
        [
            new()
            {
                ["id"] = "charts-row",
                ["component"] = "Row",
                ["children"] = new List<string> { "bar-card", "area-card" },
            },
            new()
            {
                ["id"] = "bar-card",
                ["component"] = "Card",
                ["title"] = "Completed Work",
                ["description"] = "Progress by phase.",
                ["children"] = new List<string> { "bar-chart" },
            },
            new()
            {
                ["id"] = "bar-chart",
                ["component"] = "BarChart",
                ["data"] = new List<A2UIDataPoint>
                {
                    new(Label: "Plan", Value: 34),
                    new(Label: "Build", Value: 58),
                    new(Label: "Verify", Value: 82),
                },
            },
            new()
            {
                ["id"] = "area-card",
                ["component"] = "Card",
                ["title"] = "Confidence Trend",
                ["description"] = "Confidence and review progress.",
                ["children"] = new List<string> { "area-chart" },
            },
            new()
            {
                ["id"] = "area-chart",
                ["component"] = "AreaChart",
                ["data"] = new List<A2UIDataPoint>
                {
                    new(Label: "Plan", Value: 34, Secondary: 18),
                    new(Label: "Build", Value: 58, Secondary: 31),
                    new(Label: "Verify", Value: 82, Secondary: 52),
                },
            },
        ]);

        return fallback;
    }

    private static string NormalizeComponentName(string component) => component switch
    {
        "StatusBadge" => "Badge",
        "PrimaryButton" => "Button",
        "PieChart" => "DonutChart",
        "InfoRow" => "Metric",
        _ => component,
    };

    private static void AddIfPresent(Dictionary<string, object?> item, string key, object? value)
    {
        switch (value)
        {
            case null:
                return;
            case string text when string.IsNullOrWhiteSpace(text):
                return;
            case System.Collections.ICollection collection when collection.Count == 0:
                return;
            default:
                item[key] = value;
                return;
        }
    }

    private static string? NormalizeVariant(string? variant)
    {
        var normalized = variant?.Trim().ToLowerInvariant();
        return normalized is "default" or "secondary" or "success" or "warning" or "danger" or "info" or "outline" or "ghost"
            ? normalized
            : null;
    }

    private static string? NormalizeRisk(string? risk)
    {
        var normalized = risk?.Trim().ToLowerInvariant();
        return normalized is "low" or "medium" or "high"
            ? normalized
            : null;
    }

    private static string? NormalizeTrend(string? trend)
    {
        var normalized = trend?.Trim().ToLowerInvariant();
        return normalized is "up" or "down" or "neutral"
            ? normalized
            : null;
    }

    internal sealed record A2UIComponentNode(
        string Id,
        string Component,
        string? Title = null,
        string? Subtitle = null,
        string? Description = null,
        string? Summary = null,
        string? Eyebrow = null,
        string? Badge = null,
        List<string>? Children = null,
        string? Child = null,
        string? Label = null,
        string? Value = null,
        double? NumericValue = null,
        string? Detail = null,
        string? Trend = null,
        string? Tone = null,
        string? Text = null,
        string? Variant = null,
        bool? Checked = null,
        string? Placeholder = null,
        string? Owner = null,
        string? Notes = null,
        string? Command = null,
        string? Risk = null,
        List<A2UIOption>? Options = null,
        List<A2UIDataPoint>? Data = null,
        List<A2UIMetric>? Metrics = null,
        List<A2UITableRow>? Rows = null,
        List<A2UITimelineEvent>? Events = null,
        List<A2UIFileImpact>? Files = null,
        List<A2UIApprovalCheck>? Checks = null,
        List<string>? Followups = null);

    internal sealed record A2UIMetric(
        string Label,
        string Value,
        string? Detail = null,
        string? Trend = null,
        string? Tone = null);

    internal sealed record A2UIDataPoint(
        string? Label = null,
        string? Name = null,
        string? Capability = null,
        double? Value = null,
        double? Secondary = null,
        double? ToolCalls = null,
        double? Evidence = null,
        double? Approvals = null,
        double? Score = null);

    internal sealed record A2UIOption(string Label, string Value);
    internal sealed record A2UITableRow(string Check, string Status, double Progress, string Detail);
    internal sealed record A2UITimelineEvent(string Label, string Date, string? Detail = null, string? Tone = null);
    internal sealed record A2UIFileImpact(string Path, string Risk, string Change);
    internal sealed record A2UIApprovalCheck(string Label, bool Complete);

    private static string ResolveFixtureRoot()
    {
        // CONTROL_ROOM_EXAMPLE_ROOT lets the Docker image place fixture-template at a
        // path that doesn't match the host showcases/ layout. The active fixture lives
        // at <exampleRoot>/.control-room-fixture; Harness's FileAccessProvider sandbox
        // is anchored here so the agent cannot escape the fixture.
        var exampleRoot = Environment.GetEnvironmentVariable("CONTROL_ROOM_EXAMPLE_ROOT")
            ?? AppContext.BaseDirectory;
        var fixtureRoot = Path.Combine(exampleRoot, ".control-room-fixture");
        Directory.CreateDirectory(fixtureRoot);
        SeedFixtureIfEmpty(exampleRoot, fixtureRoot);
        return fixtureRoot;
    }

    private static void SeedFixtureIfEmpty(string exampleRoot, string fixtureRoot)
    {
        if (Directory.EnumerateFileSystemEntries(fixtureRoot).Any())
        {
            return;
        }

        var templateRoot = Path.Combine(exampleRoot, "fixture-template");
        if (!Directory.Exists(templateRoot))
        {
            return;
        }

        CopyDirectory(templateRoot, fixtureRoot);
    }

    private static void CopyDirectory(string source, string destination)
    {
        foreach (var dir in Directory.EnumerateDirectories(source, "*", SearchOption.AllDirectories))
        {
            Directory.CreateDirectory(Path.Combine(destination, Path.GetRelativePath(source, dir)));
        }

        foreach (var file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
        {
            var dest = Path.Combine(destination, Path.GetRelativePath(source, file));
            Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
            File.Copy(file, dest, overwrite: true);
        }
    }

    private static string BuildInstructions() => """
        You are the Control Room Agent, running inside a Microsoft Agent Harness with
        planning mode, todos, file memory, tool approval, shell access, and file
        access all pre-configured.

        ## Workspace

        The workspace at `.control-room-fixture` is a small TypeScript project
        with source code, tests, scripts, and sample CSV data. It is meant to
        demonstrate general agent-focused work: reading code, inspecting data,
        planning changes, rendering UI, and using approvals before commands.

        FileAccess paths are already rooted at `.control-room-fixture`. Use
        relative paths such as `README.md`, `src/metrics.ts`,
        `data/revenue.csv`, and `data/incidents.csv`. Do not prefix paths with
        `.control-room-fixture/`, `/app/`, or an absolute path.

        ## Default behavior

        - If the operator asks a general question, answer directly.
        - If the operator asks about the workspace, code, tests, or data,
          inspect the relevant files first.
        - Use todos for multi-step work so progress is visible in Harness.
        - Use file memory for durable notes, handoffs, or summaries when the
          operator asks for persistence.
        - Stay in Plan mode for read-only analysis and previews. Switch to Act
          mode before edits or command execution.
        - Do not edit files or run commands unless the operator asks for that
          level of action.

        ## Stage demo contract

        Follow the operator's current prompt exactly. Some presenter pills are
        read-only planning or visualization moments; for those, do not switch
        to Act mode, edit files, or run commands.

        Frontend display tools are named `show...` (for example
        `showBarChart`, `showLineChart`, `showAreaChart`,
        `showHarnessSummary`, and `showHandoffForm`). When A2UI is available,
        prefer `render_control_room_a2ui` instead of `show...` display tools so
        the local A2UI catalog can compose multiple UI pieces in one generated
        surface. A2UI is registered locally as
        `copilotkit://ms-agent-harness-control-room`; do not emit A2UI
        operations for the public basic catalog URL.

        For A2UI, call `render_control_room_a2ui` with a flat `components`
        array. Every component object must include a unique `id` and a
        `component` name. The root component must be `{ id: "root",
        component: "Surface" }` for dashboards and reports. Container
        components (`Surface`, `Card`, `Row`, `Column`) reference children by
        id via a `children` array; never inline child objects. Build the full
        UI in one call instead of making one call per chart or card. The custom
        catalog includes ShadCN-style primitives and sidebar components:
        `Surface`, `SectionHeader`, `Card`, `Metric`, `Badge`, `Button`,
        `TextInput`, `Textarea`, `Select`, `Checkbox`, `Switch`, `Progress`,
        `BarChart`, `LineChart`, `AreaChart`, `StackedAreaChart`, `DonutChart`,
        `RadarChart`, `RadialChart`, `Calendar`, `RunHealthTable`,
        `FileImpactMap`, `ApprovalForm`, and `HandoffForm`. Basic `Row` and
        `Column` are also available for layout composition.

        Example: if the operator asks for a dashboard with a bar chart and an
        area chart describing progress, do not call TodoList, FileMemory,
        FileAccess, AgentMode, approval, shell, or `show...` display tools.
        Make one `render_control_room_a2ui` call whose components contain a
        root `Surface`, a `Row` of `Metric` nodes, and a chart `Row` containing
        two `Card` nodes, one with `BarChart` and one with `AreaChart`. The tool
        owns the surface id, local catalog id, and A2UI operation envelope.
        Do not call any tool named `render_a2ui`, do not pass `catalogId`, and
        do not hand-write `a2ui_operations`. Treat every display call as the
        final action of the current turn. Never call a display tool while a
        Harness tool action still needs to happen, and never call a display
        tool in the same model step as TodoList, FileMemory, FileAccess,
        AgentMode, approval, or shell tools. Complete those Harness actions
        first, wait for their results, then render exactly one final display
        component when the operator prompt asks for one.

        For workspace orientation prompts that ask for a final Harness Summary,
        the required Harness work is: load the workspace-analysis skill, read
        `README.md`, list the top-level files, and finish any todo updates.
        `showHarnessSummary` or an A2UI `Card` summary is not final until those
        results are visible. Once it is rendered, stop without additional text
        or tool calls.

        Do not claim that todos, memory, file writes, approvals, shell commands,
        or verification have completed unless the matching Harness tool result
        is already present in the conversation. If a display component mentions
        todos, call TodoList first and wait for the result before rendering it.
        A tool request is not complete when you decide to call it; it is only
        complete after the tool result is visible in your context.

        If the operator asks for a simple chart, dashboard, form, table,
        calendar, or other visual demo and does not ask to inspect workspace
        data, render the relevant A2UI surface or `show...` component directly
        with small illustrative data. Do not create todos or switch modes for
        pure display-only visualization prompts. If the prompt mentions
        workspace data or a file path, read that file first and wait for the
        FileAccess result before rendering any display component. If the file
        cannot be read, explain the problem and stop instead of rendering
        guessed data.

        If the operator asks to run or verify something, use `pnpm_run` so the
        real Harness approval card appears. Stop at the approval card until the
        presenter approves it. After approval, if the command reports missing
        dependencies, continue automatically: call `pnpm_run("install")`, wait
        for it, then call the original command again.

        ## Tools

        - `pnpm_run(command)` is the ONLY way to execute shell commands. It is
          locked to approved commands: install, test, test:coverage,
          typecheck, and data:summary. Harness's ToolApproval gate fires before
          each invocation, so the user sees an approval card. Do not attempt
          any other shell execution — there is no general shell tool in this
          build.

        ## Rules

        - File access is sandboxed to the workspace root by Harness.
        - Shell commands are gated by ToolApproval. If the user rejects, halt the
          turn and explain.
        - Use the workspace-analysis skill when a request benefits from a
          structured read-first workflow.
        - For read-only visualization prompts, keep the interaction complete:
          do the needed reads first, render one final component, then stop.
        """;
}
