using System.ClientModel;
using System.ComponentModel;
using System.Diagnostics;
using System.Text;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using OpenAI;

namespace MsAgentHarnessControlRoom.Agent;

/// <summary>
/// Builds the Control Room agent on top of the Microsoft Agent Harness, wired to
/// OpenAI's Responses API. Harness pre-configures the AgentMode, Todo,
/// FileMemory, ToolApproval, AgentSkills, and Shell providers — so this factory
/// only supplies the chat client, the fixture-focused instructions, and an
/// OpenAI-direct API key.
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

        // The fixture lives in the container's writable layer; Harness's
        // FileMemoryProvider gets its own subdirectory so memory survives
        // separately from the working repo.
        var fixtureRoot = ResolveFixtureRoot();
        var memoryRoot = Path.Combine(AppContext.BaseDirectory, "agent-files");
        Directory.CreateDirectory(memoryRoot);

        // Harness's `ShellExecutor` is intentionally null in this build —
        // see docs/superpowers/gap-analysis/2026-05-26-ag-ui-harness-gap.md
        // for why. To keep the demo runnable end-to-end we register a single
        // narrow AIFunction that runs the four fixture pnpm scripts inside
        // the container. The function is registered on ChatOptions.Tools, so
        // the agent invokes it like any tool call; Harness's ToolApproval
        // wrapper still gates it.
        var pnpmTool = AIFunctionFactory.Create(
            (string command, CancellationToken ct) => RunPnpmCommand(fixtureRoot, command, ct),
            new AIFunctionFactoryOptions
            {
                Name = "pnpm_run",
                Description =
                    "Run one of the four allowed pnpm scripts inside the fixture repo: " +
                    "install, test, test:coverage, typecheck. Returns exit code + stdout + stderr.",
            });

        // Gate every pnpm_run invocation through Harness's ToolApprovalAgent.
        // The wrapper makes the function emit a ToolApprovalRequestContent on
        // each call; our ApprovalContentWireBridge converts that into a
        // synthetic `request_tool_approval` tool call so it crosses the
        // AG-UI wire and a Harness approval card renders in the cockpit.
        var gatedPnpmTool = new ApprovalRequiredAIFunction(pnpmTool);

        var harnessAgent = chatClient.AsHarnessAgent(
            MaxContextWindowTokens,
            MaxOutputTokens,
            new HarnessAgentOptions
            {
                Name = AgentName,
                Description =
                    "Control Room agent — plans, executes, and self-checks fixes against a " +
                    "fixture repository with HITL approvals on every shell command, file " +
                    "write, and patch application.",
                // Sandbox file access to the fixture root; HITL approvals are
                // enabled by default for any write. FileAccessProvider rejects
                // reads and writes outside this directory.
                FileAccessStore = new FileSystemAgentFileStore(fixtureRoot),
                // File memory lives in a separate directory so it survives
                // fixture resets and the agent can carry forward notes across
                // sessions.
                FileMemoryStore = new FileSystemAgentFileStore(memoryRoot),
                ChatOptions = new ChatOptions
                {
                    Instructions = BuildInstructions(),
                    MaxOutputTokens = MaxOutputTokens,
                    Tools = [gatedPnpmTool],
                },
            });

        // Outermost wrapper: app-owned content-bridge that converts
        // ToolApprovalRequestContent ↔ a synthetic `request_tool_approval`
        // function-call so the AG-UI wire (which only serialises function-
        // calls + text) can carry the approval flow end-to-end.
        return new ApprovalContentWireBridge(harnessAgent);
    }

    /// <summary>
    /// Runs one of the four allowed pnpm scripts (`install`, `test`,
    /// `test:coverage`, `typecheck`) in the fixture working directory, with a
    /// hard timeout and stdout/stderr captured. Harness's ToolApproval wrapper
    /// fires the approval gate before this is invoked.
    /// </summary>
    private static async Task<PnpmCommandResult> RunPnpmCommand(
        string fixtureRoot,
        [Description("One of: install | test | test:coverage | typecheck")] string command,
        CancellationToken cancellationToken)
    {
        if (command is not ("install" or "test" or "test:coverage" or "typecheck"))
        {
            return new PnpmCommandResult(
                Command: command,
                ExitCode: -1,
                TimedOut: false,
                Stdout: "",
                Stderr: $"Refusing to run '{command}'. Allowed: install, test, test:coverage, typecheck.");
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
        return fixtureRoot;
    }

    private static string BuildInstructions() => """
        You are the Control Room Agent, running inside a Microsoft Agent Harness with
        planning mode, todos, file memory, tool approval, shell access, and file
        access all pre-configured.

        ## The task

        The fixture repository at `.control-room-fixture` contains a deliberately
        failing test. Plan a fix, then execute it under HITL approval, then verify
        the fix by rerunning the tests.

        ## Workflow

        1. Inspect the fixture: list files, read `src/calculator.ts` and
           `src/calculator.test.ts`. Identify the bug.
        2. Capture your plan as todos (Harness's TodoProvider).
        3. Switch into Act mode and propose a minimal patch. Request approval
           before applying.
        4. After the patch lands, call the `pnpm_run` tool with command "test".
           If it reports missing dependencies, first run `pnpm_run` with
           command "install", then re-run "test".
        5. Call `pnpm_run` with command "test:coverage" for the final
           verification.
        6. Switch to Review mode. Save a short post-mortem to file memory so it
           survives compaction.

        ## Tools

        - `pnpm_run(command)` is the ONLY way to execute shell commands. It is
          locked to the four allowed scripts (install, test, test:coverage,
          typecheck). Harness's ToolApproval gate fires before each invocation,
          so the user sees an approval card. Do not attempt any other shell
          execution — there is no general shell tool in this build.

        ## Rules

        - File access is sandboxed to the fixture root by Harness.
        - Shell commands are gated by ToolApproval. If the user rejects, halt the
          turn and explain.
        - Always update the todo list before and after each material action so the
          user can follow along.
        """;
}
