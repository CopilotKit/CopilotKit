import { useTodo } from "@/contexts/TodoContext";
import { useState, ChangeEvent } from "react";
import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import { Check, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";



export const TodoApp = () => {
    const { todos, addTodo, toggleTodo, deleteTodo, toggleAccordion, addSubtask, toggleSubtask, deleteSubtask, addTaskAndSubtask } = useTodo();
    const [newTodo, setNewTodo] = useState("");
    const [newSubtask, setNewSubtask] = useState<{ parentId: number | null; text: string }>({
      parentId: null,
      text: "",
    });
    // const subtaskInputRef = useRef<HTMLInputElement>(null);
  
    const handleAddTodo = () => {
      if (newTodo.trim() === "") return;
      addTodo(newTodo);
      setNewTodo("");
    };
  
    const handleAddSubtask = (parentIndex: number) => {
      if (newSubtask.text.trim() === "") return;
      addSubtask(parentIndex, newSubtask.text);
      setNewSubtask({ parentId: null, text: "" });
      
    };
  
    const handleSubtaskChange = (e: ChangeEvent<HTMLInputElement>, todoId: number) => {
      setNewSubtask({ parentId: todoId, text: e.target.value });
    };
  
    useCopilotAction({
      name: "ADD_TASK",
      description: "Adds a task to the todo list",
      parameters: [
        {
          name: "title",
          type: "string",
          description: "The title of the task",
          required: true,
        },
      ],
      handler: ({ title }) => {
        addTodo(title);
      }
    });
  
    useCopilotAction({
      name: "ADD_SUBTASK",
      description: "Adds a subtask to the todo list",
      parameters: [
        {
          name: "id",
          type: "number",
          description: "The id of the parent task in the todo list",
          required: true,
        },
        {
          name: "subtask",
          type: "string",
          description: "The subtask to add",
          required: true,
        },
      ],
      handler: ({ id, subtask }) => {
        debugger
        addSubtask(id, subtask);
      }
    });
  
  
    useCopilotReadable({
      description: "The current state of the todo list",
      value: JSON.stringify(todos),
    })
  
    useCopilotAction({
      name: "ADD_TASK_AND_SUBTASK",
      description: "Adds a task and its subtask to the todo list",
      parameters: [
        {
          name: "title",
          type: "string",
          description: "The title of the task",
          required: true,
        },
        {
          name: "subtask",
          type: "string[]",
          description: "The subtask to add",
          required: true,
        },
      ],
      handler: ({ title, subtask }) => {
        addTaskAndSubtask(title, subtask);
      }
    });
  
    useCopilotAction({
      name: "DELETE_TASK",
      description: "Deletes a parent todo item from the todo list",
      parameters: [
        {
          name: "id",
          type: "number",
          description: "The id of the todo item to be deleted",
          required: true,
        },
      ],
      handler: ({ id }) => {
        deleteTodo(id);
      },
    });
  
    useCopilotAction({
      name: "DELETE_SUBTASK",
      description: "Deletes a subtask from the todo list",
      parameters: [
        {
          name: "parentId",
          type: "number",
          description: "The id of the parent todo item to be deleted",
          required: true,
        },
        {
          name: "subtaskId",
          type: "number",
          description: "The id of the subtask to be deleted",
          required: true,
        },
      ],
      handler: ({ parentId, subtaskId }) => {
        deleteSubtask(parentId, subtaskId);
      },
    });
  
    useCopilotAction({
      name: "COMPLETE_TASK",
      description: "Completes a parent todo item from the todo list",
      parameters: [
        {
          name: "id",
          type: "number",
          description: "The id of the todo item to be completed",
          required: true,
        },
      ],
      handler: ({ id }) => {
        toggleTodo(id);
      },
    });
  
    useCopilotAction({
      name: "COMPLETE_SUBTASK",
      description: "Completes a subtask from the todo list",
      parameters: [
        {
          name: "parentId",
          type: "number",
          description: "The id of the parent todo item",
          required: true,
        },
        {
          name: "subtaskId",
          type: "number",
          description: "The id of the subtask to be completed",
          required: true,
        },
      ],
      handler: ({ parentId, subtaskId }) => {
        toggleSubtask(parentId, subtaskId);
      },
    });
  
    return (
      <div className="flex flex-col items-center justify-start h-full w-full max-w-2xl mx-auto">
        <div className="w-full mb-4 text-left">
          <h2 className="text-xl font-semibold">Focused Actions</h2>
          <p className="text-sm text-gray-500">Immediate items to complete</p>
        </div>
        
        <div className="flex w-full mb-6">
          <input
            type="text"
            value={newTodo}
            onChange={(e) => setNewTodo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddTodo()}
            placeholder="Add a new task..."
            className="flex-grow p-3 border border-gray-300 rounded-l-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleAddTodo}
            className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-r-lg flex items-center"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
  
        <div className="w-full space-y-3">
          {todos.length === 0 ? (
            <p className="text-center text-gray-500 italic">No todos yet. Add one above!</p>
          ) : (
            todos.map((todo,index) => (
              <div
                key={index}
                className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden"
              >
                <div 
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50" 
                  onClick={() => toggleAccordion(todo.id)}
                >
                  <div className="flex items-center flex-1 min-w-0">
                    <button
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        toggleAccordion(todo.id); 
                      }}
                      className="mr-2 text-gray-500 hover:text-gray-700 flex-shrink-0"
                    >
                      {todo.expanded ? (
                        <ChevronDown className="w-5 h-5" />
                      ) : (
                        <ChevronRight className="w-5 h-5" />
                      )}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleTodo(todo.id);
                      }}
                      className={`w-6 h-6 rounded-full border-2 mr-3 flex items-center justify-center flex-shrink-0 ${todo.completed
                        ? "bg-green-500 border-green-500"
                        : "border-gray-400"
                        }`}
                    >
                      {todo.completed && <Check className="w-4 h-4 text-white" />}
                    </button>
                    <span
                      className={`inline-block truncate ${todo.completed ? "line-through text-gray-400" : "text-gray-800"
                        }`}
                      title={todo.text}
                    >
                      {todo.text}
                    </span>
                  </div>
                  <div className="flex items-center ml-4 flex-shrink-0">
                    {todo.subtasks.length > 0 && (
                      <span className="text-xs font-medium mr-2 px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                        {todo.subtasks.length}
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteTodo(todo.id);
                      }}
                      className="text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
  
                {todo.expanded && (
                  <div className="border-t border-gray-200 p-4 bg-gray-50">
                    <div className="flex w-full mb-3">
                      <input
                        type="text"
                        value={newSubtask.text}
                        onChange={(e) => handleSubtaskChange(e, todo.id)}
                        onKeyDown={(e) => e.key === "Enter" && handleAddSubtask(todo.id)}
                        placeholder="Add a subtask..."
                        className="flex-grow p-2 border border-gray-300 rounded-l-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      />
                      <button
                        onClick={() => handleAddSubtask(todo.id)}
                        className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-2 rounded-r-lg flex items-center"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
  
                    {todo.subtasks.length > 0 ? (
                      <div className="space-y-2">
                        {todo.subtasks.map((subtask) => (
                          <div
                            key={subtask.id+Math.random()}
                            className="flex items-center justify-between p-2 bg-white rounded border border-gray-200"
                          >
                            <div className="flex items-center">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleSubtask(todo.id, subtask.id);
                                }}
                                className={`w-5 h-5 rounded-full border-2 mr-2 flex items-center justify-center ${subtask.completed
                                  ? "bg-green-500 border-green-500"
                                  : "border-gray-400"
                                  }`}
                              >
                                {subtask.completed && <Check className="w-3 h-3 text-white" />}
                              </button>
                              <span
                                className={`text-sm ${subtask.completed ? "line-through text-gray-400" : "text-gray-800"
                                  }`}
                              >
                                {subtask.text}
                              </span>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteSubtask(todo.id, subtask.id);
                              }}
                              className="text-red-500 hover:text-red-700"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-center text-gray-500 italic text-sm">No subtasks yet</p>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    );
  };