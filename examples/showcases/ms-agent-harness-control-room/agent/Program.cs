using Microsoft.Agents.AI.Hosting.AGUI.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddAGUI();

// The cockpit talks to this agent directly from the browser (no Next.js
// runtime middleman in v2). Allow any local origin so localhost:3000 / :3001
// can hit the AG-UI endpoint over fetch + SSE without preflight rejection.
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.SetIsOriginAllowed(_ => true).AllowAnyHeader().AllowAnyMethod().AllowCredentials()));

var app = builder.Build();

app.UseCors();

// Build the Harness-backed Control Room agent. AsHarnessAgent pre-configures
// AgentMode, Todo, FileMemory, ToolApproval, AgentSkills, and Shell providers,
// and MapAGUI projects all of those over AG-UI to the cockpit.
var agentFactory = new MsAgentHarnessControlRoom.Agent.ControlRoomAgentFactory(builder.Configuration);
var agent = agentFactory.CreateControlRoomAgent();

// Liveness probe — Next.js and humans alike use this to confirm the container
// is up before driving the cockpit.
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

// Fixture-reset is the only non-AG-UI app concern Harness doesn't own. We just
// wipe the active fixture directory; Harness's FileAccessProvider will see the
// fresh state on next access. fixture-template is COPYed into the container by
// the Dockerfile and is the canonical seed.
app.MapPost("/fixture/reset", () =>
{
    var exampleRoot = Environment.GetEnvironmentVariable("CONTROL_ROOM_EXAMPLE_ROOT")
        ?? AppContext.BaseDirectory;
    var fixtureRoot = Path.Combine(exampleRoot, ".control-room-fixture");
    var templateRoot = Path.Combine(exampleRoot, "fixture-template");

    if (!Directory.Exists(templateRoot))
    {
        return Results.NotFound(new { error = $"fixture-template not found at {templateRoot}" });
    }

    if (Directory.Exists(fixtureRoot))
    {
        Directory.Delete(fixtureRoot, recursive: true);
    }
    CopyDirectory(templateRoot, fixtureRoot);

    var fileCount = Directory.EnumerateFiles(fixtureRoot, "*", SearchOption.AllDirectories).Count();
    return Results.Ok(new { reset = true, file_count = fileCount });
});

app.MapAGUI("/", agent);

await app.RunAsync();

static void CopyDirectory(string source, string destination)
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
