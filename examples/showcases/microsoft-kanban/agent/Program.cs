using Microsoft.Agents.AI;
using Microsoft.Agents.AI.AGUI;
using Microsoft.Agents.AI.AGUI.Shared;
using Microsoft.Agents.AI.Hosting.AGUI.AspNetCore;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Options;
using OpenAI;
using ProverbsAgent.Models;
using ProverbsAgent.Services;
using System.Text.Json.Serialization;

var builder = WebApplication.CreateBuilder(args);

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.TypeInfoResolverChain.Add(CanvasAgentSerializerContext.Default);
});

// Register AGUI services
builder.Services.AddAGUI();

var app = builder.Build();

// Create the agent factory and map the AG-UI agent endpoint
var jsonOptions = app.Services.GetRequiredService<IOptions<JsonOptions>>();
var agentFactory = new CanvasAgentFactory(builder.Configuration, jsonOptions.Value.SerializerOptions);
app.MapAGUI("/", agentFactory.CreateCanvasAgent());

app.Run();

// =================
// Agent Factory
// =================
public class CanvasAgentFactory
{
    private readonly IConfiguration _configuration;
    private readonly AgentState _state;
    private readonly OpenAIClient _openAiClient;
    private readonly System.Text.Json.JsonSerializerOptions _jsonSerializerOptions;

    public CanvasAgentFactory(IConfiguration configuration, System.Text.Json.JsonSerializerOptions jsonSerializerOptions)
    {
        _configuration = configuration;
        _jsonSerializerOptions = jsonSerializerOptions;

        // Initialize with a default board matching frontend initialState
        _state = new AgentState
        {
            Boards = new List<Board>
            {
                new Board
                {
                    Id = "board001",
                    Name = "My First Board",
                    Tasks = new List<KanbanTask>()
                }
            },
            ActiveBoardId = "board001",
            LastAction = ""
        };

        var openAiKey = _configuration["OpenAIKey"]
            ?? throw new InvalidOperationException("OpenAIKey not found in configuration. Run: dotnet user-secrets set OpenAIKey \"YOUR_OPENAI_API_KEY\"");

        _openAiClient = new OpenAIClient(openAiKey);
    }

    public AIAgent CreateCanvasAgent()
    {
        // Create Kanban service with shared state
        var kanbanService = new KanbanService(_state);

        var chatClient = _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient();

        var chatClientAgent = chatClient.CreateAIAgent(
            name: "my_agent",
            instructions: @"A helpful assistant managing Kanban boards and tasks.

You have tools to manage boards and tasks:
- State: get_state (call this after modifications to see current state)
- Board tools: create_board, delete_board, rename_board, switch_board
- Task tools: create_task, update_task_field, add_task_tag, remove_task_tag, move_task_to_status, delete_task

Each task has title, subtitle, description, tags[], and status.
Tasks flow through 4 statuses: new → in_progress → review → completed.

IMPORTANT: After creating or modifying boards/tasks, call get_state to retrieve the current state.",
            tools: [
                AIFunctionFactory.Create(kanbanService.GetState, new AIFunctionFactoryOptions { Name = "get_state", SerializerOptions = _jsonSerializerOptions }),
                AIFunctionFactory.Create(kanbanService.CreateBoard, new AIFunctionFactoryOptions { Name = "create_board", SerializerOptions = _jsonSerializerOptions }),
                AIFunctionFactory.Create(kanbanService.DeleteBoard, new AIFunctionFactoryOptions { Name = "delete_board", SerializerOptions = _jsonSerializerOptions }),
                AIFunctionFactory.Create(kanbanService.SwitchBoard, new AIFunctionFactoryOptions { Name = "switch_board", SerializerOptions = _jsonSerializerOptions }),
                AIFunctionFactory.Create(kanbanService.RenameBoard, new AIFunctionFactoryOptions { Name = "rename_board", SerializerOptions = _jsonSerializerOptions }),
                AIFunctionFactory.Create(kanbanService.CreateTask, new AIFunctionFactoryOptions { Name = "create_task", SerializerOptions = _jsonSerializerOptions }),
                AIFunctionFactory.Create(kanbanService.UpdateTaskField, new AIFunctionFactoryOptions { Name = "update_task_field", SerializerOptions = _jsonSerializerOptions }),
                AIFunctionFactory.Create(kanbanService.AddTaskTag, new AIFunctionFactoryOptions { Name = "add_task_tag", SerializerOptions = _jsonSerializerOptions }),
                AIFunctionFactory.Create(kanbanService.RemoveTaskTag, new AIFunctionFactoryOptions { Name = "remove_task_tag", SerializerOptions = _jsonSerializerOptions }),
                AIFunctionFactory.Create(kanbanService.MoveTaskToStatus, new AIFunctionFactoryOptions { Name = "move_task_to_status", SerializerOptions = _jsonSerializerOptions }),
                AIFunctionFactory.Create(kanbanService.DeleteTask, new AIFunctionFactoryOptions { Name = "delete_task", SerializerOptions = _jsonSerializerOptions })
            ]
        );

        // Wrap with SharedStateAgent for AG-UI state synchronization
        return new SharedStateAgent(chatClientAgent, _jsonSerializerOptions, _state);
    }
}

public partial class Program { }

// =================
// State Snapshot
// =================
public class AgentStateSnapshot
{
    [JsonPropertyName("boards")]
    public List<Board> Boards { get; set; } = new();

    [JsonPropertyName("activeBoardId")]
    public string ActiveBoardId { get; set; } = string.Empty;

    [JsonPropertyName("lastAction")]
    public string? LastAction { get; set; }
}

// =================
// Serializer Context
// =================
[JsonSerializable(typeof(AgentStateSnapshot))]
[JsonSerializable(typeof(Board))]
[JsonSerializable(typeof(KanbanTask))]
[JsonSerializable(typeof(AgentState))]
internal sealed partial class CanvasAgentSerializerContext : JsonSerializerContext;
