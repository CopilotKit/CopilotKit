using System.ClientModel;
using System.ComponentModel;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
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
                    "Render one local A2UI component as the final display action. " +
                    "Supported components: HarnessSummary, BarChart, LineChart, AreaChart, DonutChart, DataTable, FileList. " +
                    "Use literal values only; do not use path bindings. Returns A2UI operations for the local catalog.",
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
        [Description("One of: HarnessSummary | BarChart | LineChart | AreaChart | DonutChart | DataTable | FileList.")]
        string component,
        [Description("Short component title.")]
        string? title = null,
        [Description("One concise supporting sentence.")]
        string? description = null,
        [Description("Metrics for HarnessSummary. Two to six items.")]
        List<A2UIMetric>? metrics = null,
        [Description("Category data for BarChart, LineChart, and DonutChart. Two to eight items.")]
        List<A2UICategoryPoint>? data = null,
        [Description("Trend data for AreaChart. Two to eight items.")]
        List<A2UIAreaPoint>? areaData = null,
        [Description("Rows for DataTable. Two to eight items.")]
        List<A2UITableRow>? rows = null,
        [Description("Files for FileList. One to eight items.")]
        List<A2UIFileItem>? files = null)
    {
        var supportedComponents = new HashSet<string>(StringComparer.Ordinal)
        {
            "HarnessSummary",
            "BarChart",
            "LineChart",
            "AreaChart",
            "DonutChart",
            "DataTable",
            "FileList",
        };

        if (!supportedComponents.Contains(component))
        {
            return JsonSerializer.Serialize(new
            {
                error = $"Unsupported A2UI component '{component}'. Use one of: {string.Join(", ", supportedComponents)}."
            });
        }

        var surfaceId = $"control-room-{component.ToLowerInvariant()}-{Guid.NewGuid():N}";
        var root = new Dictionary<string, object?>
        {
            ["id"] = "root",
            ["component"] = component,
        };

        if (!string.IsNullOrWhiteSpace(title)) root["title"] = title;
        if (!string.IsNullOrWhiteSpace(description)) root["description"] = description;

        switch (component)
        {
            case "HarnessSummary":
                root["metrics"] = metrics is { Count: > 0 }
                    ? metrics
                    : new List<A2UIMetric>
                    {
                        new("Mode", "plan", "Read-only display"),
                        new("Surface", "A2UI", "Local catalog"),
                        new("Status", "ready", "Rendered by Harness"),
                    };
                break;
            case "BarChart":
            case "LineChart":
            case "DonutChart":
                root["data"] = data is { Count: > 0 }
                    ? data
                    : new List<A2UICategoryPoint>
                    {
                        new("Jan", 12),
                        new("Feb", 18),
                        new("Mar", 24),
                    };
                break;
            case "AreaChart":
                root["data"] = areaData is { Count: > 0 }
                    ? areaData
                    : new List<A2UIAreaPoint>
                    {
                        new("Plan", 1, 0),
                        new("Inspect", 2, 1),
                        new("Verify", 3, 2),
                    };
                break;
            case "DataTable":
                root["rows"] = rows is { Count: > 0 }
                    ? rows
                    : new List<A2UITableRow>
                    {
                        new("Mode", "pass", "Plan", "Read-only"),
                        new("Files", "pass", "2", "Available"),
                        new("Chart", "pass", "A2UI", "Rendered"),
                    };
                break;
            case "FileList":
                root["files"] = files is { Count: > 0 }
                    ? files
                    : new List<A2UIFileItem>
                    {
                        new("README.md", "read", "Workspace orientation"),
                        new("data/revenue.csv", "available", "Sample chart data"),
                    };
                break;
        }

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
                    ["components"] = new[] { root },
                },
            },
        };

        return JsonSerializer.Serialize(
            new Dictionary<string, object?> { ["a2ui_operations"] = operations },
            new JsonSerializerOptions(JsonSerializerDefaults.Web));
    }

    internal sealed record A2UIMetric(string Label, string Value, string? Detail = null);
    internal sealed record A2UICategoryPoint(string Label, double Value);
    internal sealed record A2UIAreaPoint(string Label, double Primary, double? Secondary = null);
    internal sealed record A2UITableRow(string Label, string? Status = null, string? Value = null, string? Detail = null);
    internal sealed record A2UIFileItem(string Path, string? Status = null, string? Detail = null);

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
        `showHarnessSummary`, and `showHandoffForm`). Open Generative UI and
        A2UI-generated UI are display surfaces too. For A2UI, use only the
        local `copilotkit://ms-agent-harness-control-room` catalog components:
        `HarnessSummary`, `BarChart`, `LineChart`, `AreaChart`, `DonutChart`,
        `DataTable`, and `FileList`. Do not emit A2UI operations for the
        public basic catalog URL. For A2UI, call
        `render_control_room_a2ui` with one supported component name and
        literal prop values only. The tool owns the surface id, local catalog
        id, and A2UI operation envelope. Do not call any tool named
        `render_a2ui`, do not pass `catalogId`, and do not hand-write
        `a2ui_operations`. Treat every display call as the final action of the
        current turn. Never call a display tool while a Harness tool action
        still needs to happen, and never call a display tool in the same model
        step as TodoList, FileMemory, FileAccess, AgentMode, approval, or shell
        tools. Complete those Harness actions first, wait for their results,
        then render exactly one final display component when the operator
        prompt asks for one.

        For workspace orientation prompts that ask for a final Harness Summary,
        the required Harness work is: load the workspace-analysis skill, read
        `README.md`, list the top-level files, and finish any todo updates.
        `showHarnessSummary` is not final until those results are visible. Once
        it is rendered, stop without additional text or tool calls.

        Do not claim that todos, memory, file writes, approvals, shell commands,
        or verification have completed unless the matching Harness tool result
        is already present in the conversation. If a display component mentions
        todos, call TodoList first and wait for the result before rendering it.
        A tool request is not complete when you decide to call it; it is only
        complete after the tool result is visible in your context.

        If the operator asks for a simple chart, form, table, calendar, or other
        visual demo, render the relevant `show...` component with small,
        illustrative data. If the prompt mentions workspace data or a file path,
        read that file first and wait for the FileAccess result before rendering
        any display component. If the file cannot be read, explain the problem
        and stop instead of rendering guessed data.

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
