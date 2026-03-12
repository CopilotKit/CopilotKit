import React, { createContext, useContext, useState, ReactNode } from 'react';

// Define the types for our todo items
export interface SubTask {
  id: number;
  text: string;
  completed: boolean;
  parentId?: number;
}

export interface Todo {
  id: number;
  text: string;
  completed: boolean;
  subtasks: SubTask[];
  expanded: boolean;
}

// Define the context type
interface TodoContextType {
  todos: Todo[];
  addTodo: (text: string | null) => number | null;
  toggleTodo: (id: number) => void;
  deleteTodo: (id: number) => void;
  toggleAccordion: (id: number) => void;
  addSubtask: (parentId: number, subtask: string | null) => void;
  toggleSubtask: (parentId: number, subtaskId: number) => void;
  deleteSubtask: (parentId: number, subtaskId: number) => void;
  addTaskAndSubtask: (title: string, subtask: string[]) => void;
}

// Create the context with a default value
const TodoContext = createContext<TodoContextType | undefined>(undefined);

// Create a provider component
export const TodoProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [todos, setTodos] = useState<Todo[]>([{
    id: Date.now(),
    text: "Blog Posts",
    completed: false,
    subtasks: [{
      id: 1,
      text: "Agents 101: Build an Agent in 30 Minutes",
      completed: true
    }, {
      id: 2,
      text: "Simple Stack for Powerful Agents",
      completed: false
    }, {
      id: 3,
      text: "How I Built a Helpful Agent",
      completed: false
    }, {
      id: 4,
      text: "What I Learned Building Agents",
      completed: false
    }],
    expanded: true
  }]);

  const addTodo = (str: string | null = null) => {
    if (str === null) return null;
    setTodos([
      ...todos,
      {
        id: Date.now(),
        text: str,
        completed: false,
        subtasks: [],
        expanded: false
      }
    ]);
    return todos.length;
  };

  const toggleTodo = (id: number) => {
    setTodos(
      todos.map((todo) => {
        if (todo.id === id) {
          const newCompleted = !todo.completed;
          // When parent is completed, complete all subtasks
          // When parent is uncompleted, uncomplete all subtasks
          return {
            ...todo,
            completed: newCompleted,
            subtasks: todo.subtasks.map(subtask => ({
              ...subtask,
              completed: newCompleted
            }))
          };
        }
        return todo;
      })
    );
  };

  const deleteTodo = (id: number) => {
    setTodos(todos.filter((todo) => todo.id !== id));
  };

  const toggleAccordion = (id: number) => {
    setTodos(
      todos.map((todo) =>
        todo.id === id
          ? { ...todo, expanded: !todo.expanded }
          : { ...todo, expanded: false }
      )
    );
  };

  const addSubtask = (parentId: number, subtask: string | null = null) => {
    if (subtask === null) return;

    setTodos(
      todos.map((todo) => {
        if (todo.id === parentId) {
          return {
            ...todo,
            subtasks: [
              ...todo.subtasks,
              { id: Date.now() + Math.random(), text: subtask, completed: false }
            ]
          };
        }
        return todo;
      })
    );
  };

  const addTaskAndSubtask = (title: string, subtask: string[]) => {

    setTodos([
      ...todos,
      {
        id: Date.now(),
        text: title,
        completed: false,
        subtasks: subtask.map((subtask) => ({
          id: Date.now() + Math.random(),
          text: subtask,
          completed: false
        })),
        expanded: false
      }
    ]);
  };

  const toggleSubtask = (parentId: number, subtaskId: number) => {
    debugger;
    setTodos(
      todos.map((todo) => {
        if (todo.id === parentId) {
          // First update the specific subtask
          const updatedSubtasks = todo.subtasks.map((subtask) =>
            subtask.id === subtaskId
              ? { ...subtask, completed: !subtask.completed }
              : subtask
          );

          // Then check if all subtasks are completed
          const allSubtasksCompleted = updatedSubtasks.length > 0 &&
            updatedSubtasks.every(subtask => subtask.completed);

          // Update the parent's completed status based on subtasks
          return {
            ...todo,
            completed: allSubtasksCompleted,
            subtasks: updatedSubtasks
          };
        }
        return todo;
      })
    );
  };

  const deleteSubtask = (parentId: number, subtaskId: number) => {

    setTodos(
      todos.map((todo) => {
        if (todo.id === parentId) {
          return {
            ...todo,
            subtasks: todo.subtasks.filter((subtask) => subtask.id !== subtaskId)
          };
        }
        return todo;
      })
    );
  };

  const value = {
    todos,
    addTodo,
    toggleTodo,
    deleteTodo,
    toggleAccordion,
    addSubtask,
    toggleSubtask,
    deleteSubtask,
    addTaskAndSubtask
  };

  return <TodoContext.Provider value={value}>{children}</TodoContext.Provider>;
};

// Create a custom hook to use the todo context
export const useTodo = () => {
  const context = useContext(TodoContext);
  if (context === undefined) {
    throw new Error('useTodo must be used within a TodoProvider');
  }
  return context;
}; 