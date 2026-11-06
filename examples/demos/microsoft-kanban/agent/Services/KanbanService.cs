using ProverbsAgent.Models;
using System.ComponentModel;

namespace ProverbsAgent.Services;

/// <summary>
/// Service containing all Kanban board management tools
/// </summary>
public class KanbanService
{
    private readonly AgentState _state;

    public KanbanService(AgentState state)
    {
        _state = state;
    }

    // =================
    // State Management Tools
    // =================

    [Description("Get the current state including all boards and tasks. Call this to see what exists before making changes.")]
    public AgentState GetState()
    {
        Console.WriteLine($"📊 Getting state: {_state.Boards.Count} boards, active: {_state.ActiveBoardId}");
        return _state;
    }

    // =================
    // Board Management Tools
    // =================

    [Description("Create a new board with the specified name.")]
    public string CreateBoard([Description("Name for the new board")] string name)
    {
        var boardId = GenerateId();

        var newBoard = new Board
        {
            Id = boardId,
            Name = name,
            Tasks = new List<KanbanTask>()
        };

        _state.Boards.Add(newBoard);

        // If this is the first board, set it as active
        if (_state.Boards.Count == 1)
        {
            _state.ActiveBoardId = boardId;
        }

        _state.LastAction = $"Created board '{name}'";

        Console.WriteLine($"📋 Created board: {name} (ID: {boardId})");
        return $"Created board '{name}' with ID {boardId}. Current board count: {_state.Boards.Count}";
    }

    [Description("Delete a board by its ID.")]
    public string DeleteBoard([Description("ID of the board to delete")] string boardId)
    {
        var boardToDelete = _state.Boards.FirstOrDefault(b => b.Id == boardId);
        if (boardToDelete == null)
        {
            _state.LastAction = $"Board '{boardId}' not found";
            Console.WriteLine($"🗑️ Board not found: {boardId}");
            return $"Board '{boardId}' not found";
        }

        var boardName = boardToDelete.Name;
        _state.Boards.Remove(boardToDelete);

        // If deleting the active board, switch to another board
        if (_state.ActiveBoardId == boardId)
        {
            _state.ActiveBoardId = _state.Boards.FirstOrDefault()?.Id ?? string.Empty;
        }

        _state.LastAction = $"Deleted board '{boardName}'";

        Console.WriteLine($"🗑️ Deleted board: {boardName}");
        return $"Deleted board '{boardName}'. Remaining boards: {_state.Boards.Count}";
    }

    [Description("Switch to a different board by its ID.")]
    public string SwitchBoard([Description("ID of the board to switch to")] string boardId)
    {
        var board = _state.Boards.FirstOrDefault(b => b.Id == boardId);
        if (board == null)
        {
            _state.LastAction = $"Board '{boardId}' not found";
            Console.WriteLine($"🔀 Board not found: {boardId}");
            return $"Board '{boardId}' not found";
        }

        _state.ActiveBoardId = boardId;
        _state.LastAction = $"Switched to board '{board.Name}'";

        Console.WriteLine($"🔀 Switched to board: {board.Name}");
        return $"Switched to board '{board.Name}'";
    }

    [Description("Rename a board.")]
    public string RenameBoard(
        [Description("ID of the board to rename")] string boardId,
        [Description("New name for the board")] string name)
    {
        var board = _state.Boards.FirstOrDefault(b => b.Id == boardId);
        if (board == null)
        {
            _state.LastAction = $"Board '{boardId}' not found";
            Console.WriteLine($"✏️ Board not found: {boardId}");
            return $"Board '{boardId}' not found";
        }

        var oldName = board.Name;
        board.Name = name;

        _state.LastAction = $"Renamed board from '{oldName}' to '{name}'";

        Console.WriteLine($"✏️ Renamed board from '{oldName}' to '{name}'");
        return $"Renamed board from '{oldName}' to '{name}'";
    }

    // =================
    // Task Management Tools
    // =================

    [Description("Create a new task on the active board.")]
    public string CreateTask(
        [Description("Title of the task")] string title,
        [Description("Optional subtitle for the task")] string? subtitle = null,
        [Description("Optional description for the task")] string? description = null)
    {
        var taskId = GenerateId();

        if (string.IsNullOrEmpty(_state.ActiveBoardId))
        {
            _state.LastAction = "No active board. Create a board first.";
            Console.WriteLine($"➕ Cannot create task - no active board");
            return "No active board. Create a board first.";
        }

        var activeBoard = _state.Boards.FirstOrDefault(b => b.Id == _state.ActiveBoardId);
        if (activeBoard == null)
        {
            _state.LastAction = "Active board not found";
            Console.WriteLine($"➕ Cannot create task - active board not found");
            return "Active board not found";
        }

        var newTask = new KanbanTask
        {
            Id = taskId,
            Title = title,
            Subtitle = subtitle ?? string.Empty,
            Description = description ?? string.Empty,
            Status = "new",
            Tags = new List<string>()
        };

        activeBoard.Tasks.Add(newTask);

        _state.LastAction = $"Created task '{title}' on board '{activeBoard.Name}'";

        Console.WriteLine($"➕ Created task: {title} (ID: {taskId})");
        return $"Created task '{title}' with ID {taskId} on board '{activeBoard.Name}'";
    }

    [Description("Update a field on a task. ")]
    public string UpdateTaskField(
        [Description("ID of the task to update")] string taskId,
        [Description("Field to update (title, subtitle, description, status)")] string field,
        [Description("New value for the field")] string value)
    {
        

        KanbanTask? task = null;
        foreach (var board in _state.Boards)
        {
            task = board.Tasks.FirstOrDefault(t => t.Id == taskId);
            if (task != null) break;
        }

        if (task == null)
        {
            _state.LastAction = $"Task '{taskId}' not found";
            Console.WriteLine($"📝 Task not found: {taskId}");
            return $"Task '{taskId}' not found";
        }

        switch (field.ToLower())
        {
            case "title":
                task.Title = value;
                break;
            case "subtitle":
                task.Subtitle = value;
                break;
            case "description":
                task.Description = value;
                break;
            case "status":
                task.Status = value;
                break;
            default:
                _state.LastAction = $"Unknown field '{field}'";
                Console.WriteLine($"📝 Unknown field: {field}");
                return $"Unknown field '{field}'. Valid fields: title, subtitle, description, status";
        }

        _state.LastAction = $"Updated task {field} to '{value}'";

        Console.WriteLine($"📝 Updated task {taskId}: {field} = {value} - ");
        return $"Updated task {field} to '{value}'";
    }

    [Description("Add a tag to a task. ")]
    public string AddTaskTag(
        [Description("ID of the task")] string taskId,
        [Description("Tag to add")] string tag)
    {
        

        KanbanTask? task = null;
        foreach (var board in _state.Boards)
        {
            task = board.Tasks.FirstOrDefault(t => t.Id == taskId);
            if (task != null) break;
        }

        if (task == null)
        {
            _state.LastAction = $"Task '{taskId}' not found";
            Console.WriteLine($"🏷️ Task not found: {taskId}");
            return $"Task '{taskId}' not found";
        }

        string message;
        if (!task.Tags.Contains(tag))
        {
            task.Tags.Add(tag);
            _state.LastAction = $"Added tag '{tag}' to task '{task.Title}'";
            message = $"Added tag '{tag}' to task '{task.Title}'";
        }
        else
        {
            _state.LastAction = $"Tag '{tag}' already exists on task '{task.Title}'";
            message = $"Tag '{tag}' already exists on task '{task.Title}'";
        }


        Console.WriteLine($"🏷️ {message} - ");
        return message;
    }

    [Description("Remove a tag from a task. ")]
    public string RemoveTaskTag(
        [Description("ID of the task")] string taskId,
        [Description("Tag to remove")] string tag)
    {
        

        KanbanTask? task = null;
        foreach (var board in _state.Boards)
        {
            task = board.Tasks.FirstOrDefault(t => t.Id == taskId);
            if (task != null) break;
        }

        if (task == null)
        {
            _state.LastAction = $"Task '{taskId}' not found";
            Console.WriteLine($"🏷️ Task not found: {taskId}");
            return $"Task '{taskId}' not found";
        }

        string message;
        if (task.Tags.Remove(tag))
        {
            _state.LastAction = $"Removed tag '{tag}' from task '{task.Title}'";
            message = $"Removed tag '{tag}' from task '{task.Title}'";
        }
        else
        {
            _state.LastAction = $"Tag '{tag}' not found on task '{task.Title}'";
            message = $"Tag '{tag}' not found on task '{task.Title}'";
        }


        Console.WriteLine($"🏷️ {message} - ");
        return message;
    }

    [Description("Move a task to a different status. ")]
    public string MoveTaskToStatus(
        [Description("ID of the task")] string taskId,
        [Description("New status (new, in_progress, review, completed)")] string status)
    {
        

        KanbanTask? task = null;
        foreach (var board in _state.Boards)
        {
            task = board.Tasks.FirstOrDefault(t => t.Id == taskId);
            if (task != null)
            {
                task.Status = status;
                _state.LastAction = $"Moved task '{task.Title}' to '{status}'";
                break;
            }
        }

        if (task == null)
        {
            _state.LastAction = $"Task '{taskId}' not found";
            Console.WriteLine($"➡️ Task not found: {taskId}");
            return $"Task '{taskId}' not found";
        }


        Console.WriteLine($"➡️ Moved task '{task.Title}' to '{status}' - ");
        return $"Moved task '{task.Title}' to '{status}'";
    }

    [Description("Delete a task. ")]
    public string DeleteTask([Description("ID of the task to delete")] string taskId)
    {
        

        foreach (var board in _state.Boards)
        {
            var task = board.Tasks.FirstOrDefault(t => t.Id == taskId);
            if (task != null)
            {
                var taskTitle = task.Title;
                board.Tasks.Remove(task);
                _state.LastAction = $"Deleted task '{taskTitle}'";


                Console.WriteLine($"❌ Deleted task: {taskTitle} - ");
                return $"Deleted task '{taskTitle}'";
            }
        }

        _state.LastAction = $"Task '{taskId}' not found";
        Console.WriteLine($"❌ Task not found: {taskId}");
        return $"Task '{taskId}' not found";
    }

    // =================
    // Helper Methods
    // =================

    private string GenerateId()
    {
        return Guid.NewGuid().ToString("N").Substring(0, 8);
    }
}
