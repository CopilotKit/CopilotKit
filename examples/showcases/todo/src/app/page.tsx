"use client";

import { TodoItem } from "@/components/TodoItem";
import { nanoid } from "nanoid";
import { useState } from "react";
import { Todo } from "../types/todo";

/**
 *
 * 1) CopilotKit Integration
 *
 **/

import {
  CopilotKit,
  useCopilotAction,
  useCopilotReadable,
} from "@copilotkit/react-core";
import { CopilotPopup } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";

export default function Home() {
  return (
    <div className="border rounded-md max-w-2xl mx-auto p-4">
      <h1 className="text-2xl font-bold ">Hello CopilotKit 🪁</h1>
      <h2 className="text-base font-base mb-4">Todo List Example</h2>

      {/**
       *
       * 2) Wrap the TodoList component with CopilotKit
       *
       **/}

      <CopilotKit
        publicApiKey={process.env.NEXT_PUBLIC_COPILOT_CLOUD_API_KEY}
        // Alternatively, you can use runtimeUrl to host your own CopilotKit Runtime
        // runtimeUrl="/api/copilotkit"
      >
        <TodoList />

        {/**
         *
         * 3) Add the CopilotPopup component to get the chat
         *
         */}

        <CopilotPopup
          instructions={
            "Help the user manage a todo list. If the user provides a high level goal, " +
            "break it down into a few specific tasks and add them to the list"
          }
          defaultOpen={true}
          labels={{
            title: "Todo List Copilot",
            initial: "Hi you! 👋 I can help you manage your todo list.",
          }}
          clickOutsideToClose={false}
        />
      </CopilotKit>
    </div>
  );
}

const TodoList: React.FC = () => {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [input, setInput] = useState("");

  /**
   *
   * 4) make the users todo list available with useCopilotReadable
   *
   **/
  useCopilotReadable({
    description: "The user's todo list.",
    value: todos,
  });

  /**
   *
   * 5) Add the useCopilotAction to enable the copilot to interact with the todo list
   *
   **/

  useCopilotAction({
    name: "updateTodoList",
    description: "Update the users todo list",
    parameters: [
      {
        name: "items",
        type: "object[]",
        description: "The new and updated todo list items.",
        attributes: [
          {
            name: "id",
            type: "string",
            description:
              "The id of the todo item. When creating a new todo item, just make up a new id.",
          },
          {
            name: "text",
            type: "string",
            description: "The text of the todo item.",
          },
          {
            name: "isCompleted",
            type: "boolean",
            description: "The completion status of the todo item.",
          },
          {
            name: "assignedTo",
            type: "string",
            description:
              "The person assigned to the todo item. If you don't know, assign it to 'YOU'.",
            required: true,
          },
        ],
      },
    ],
    handler: ({ items }) => {
      console.log(items);
      const newTodos = [...todos];
      for (const item of items) {
        const existingItemIndex = newTodos.findIndex(
          (todo) => todo.id === item.id
        );
        if (existingItemIndex !== -1) {
          newTodos[existingItemIndex] = item;
        } else {
          newTodos.push(item);
        }
      }
      setTodos(newTodos);
    },
    render: "Updating the todo list...",
  });

  /**
   *
   * 5) Add another useCopilotAction to enable the copilot to delete a todo item
   *
   **/
  useCopilotAction({
    name: "deleteTodo",
    description: "Delete a todo item",
    parameters: [
      {
        name: "id",
        type: "string",
        description: "The id of the todo item to delete.",
      },
    ],
    handler: ({ id }) => {
      setTodos(todos.filter((todo) => todo.id !== id));
    },
    render: "Deleting a todo item...",
  });

  const addTodo = () => {
    if (input.trim() !== "") {
      // Check if input is not just whitespace
      const newTodo: Todo = {
        id: nanoid(),
        text: input.trim(), // Trim whitespace
        isCompleted: false,
      };
      setTodos([...todos, newTodo]);
      setInput(""); // Reset input field
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      addTodo();
    }
  };

  const toggleComplete = (id: string) => {
    setTodos(
      todos.map((todo) =>
        todo.id === id ? { ...todo, isCompleted: !todo.isCompleted } : todo
      )
    );
  };

  const deleteTodo = (id: string) => {
    setTodos(todos.filter((todo) => todo.id !== id));
  };

  const assignPerson = (id: string, person: string | null) => {
    setTodos(
      todos.map((todo) =>
        todo.id === id
          ? { ...todo, assignedTo: person ? person : undefined }
          : todo
      )
    );
  };

  return (
    <div>
      <div className="flex mb-4">
        <input
          className="border rounded-md p-2 flex-1 mr-2"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyPress} // Add this to handle the Enter key press
        />
        <button
          className="bg-blue-500 rounded-md p-2 text-white"
          onClick={addTodo}
        >
          Add Todo
        </button>
      </div>
      {todos.length > 0 && (
        <div className="border rounded-lg">
          {todos.map((todo, index) => (
            <TodoItem
              key={todo.id}
              todo={todo}
              toggleComplete={toggleComplete}
              deleteTodo={deleteTodo}
              assignPerson={assignPerson}
              hasBorder={index !== todos.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};
