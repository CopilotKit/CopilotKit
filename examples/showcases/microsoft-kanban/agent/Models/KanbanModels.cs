using System.Text.Json.Serialization;

namespace ProverbsAgent.Models;

/// <summary>
/// Represents a single task in the Kanban board
/// </summary>
public class KanbanTask
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("subtitle")]
    public string Subtitle { get; set; } = string.Empty;

    [JsonPropertyName("description")]
    public string Description { get; set; } = string.Empty;

    [JsonPropertyName("tags")]
    public List<string> Tags { get; set; } = new();

    [JsonPropertyName("status")]
    public string Status { get; set; } = "new"; // new | in_progress | review | completed
}

/// <summary>
/// Represents a Kanban board containing multiple tasks
/// </summary>
public class Board
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("tasks")]
    public List<KanbanTask> Tasks { get; set; } = new();
}

/// <summary>
/// Root state object shared between frontend and backend via AG-UI protocol
/// </summary>
public class AgentState
{
    [JsonPropertyName("boards")]
    public List<Board> Boards { get; set; } = new();

    [JsonPropertyName("activeBoardId")]
    public string ActiveBoardId { get; set; } = string.Empty;

    [JsonPropertyName("lastAction")]
    public string? LastAction { get; set; }
}
