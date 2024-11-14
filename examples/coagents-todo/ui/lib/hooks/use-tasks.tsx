import { useCoAgent } from "@copilotkit/react-core";
import { useCopilotChatSuggestions } from "@copilotkit/react-ui";
import { createContext, useContext, ReactNode } from "react";

export type Task = {
  id: number;
  title: string;
  status: TaskStatus;
};

export enum TaskStatus {
  todo = "todo",
  done = "done",
}

const defaultTasks: Task[] = [
  {
    id: 1,
    title: "Complete project proposal",
    status: TaskStatus.done,
  },
  {
    id: 2,
    title: "Review design mockups",
    status: TaskStatus.done,
  },
  {
    id: 3,
    title: "Prepare presentation slides",
    status: TaskStatus.todo,
  },
  {
    id: 4,
    title: "Send meeting notes email",
    status: TaskStatus.todo,
  },
  {
    id: 5,
    title: "Review Uli's pull request",
    status: TaskStatus.todo,
  },
];

let nextId = defaultTasks.length + 1;

type TasksContextType = {
  tasks: Task[];
  addTask: (title: string) => void;
  setTaskStatus: (id: number, status: TaskStatus) => void;
  deleteTask: (id: number) => void;
};

const TasksContext = createContext<TasksContextType | undefined>(undefined);

export const TasksProvider = ({ children }: { children: ReactNode }) => {
  const { state, setState } = useCoAgent<{ todos: Task[] }>({
    name: "todo_manager_agent",
    initialState: {
      todos: defaultTasks,
    },
  });

  useCopilotChatSuggestions({
    instructions: `Offer the user one suggestion: "What can you do?". Todos state: \n ${JSON.stringify(state.todos)}`,
    minSuggestions: 1,
    maxSuggestions: 1,
  }, [state.todos]);

  const addTask = (title: string) => {
    setState({ todos: [...state.todos, { id: nextId++, title, status: TaskStatus.todo }] });
  };

  const setTaskStatus = (id: number, status: TaskStatus) => {
    setState({
      todos: state.todos.map((task) =>
        task.id === id ? { ...task, status } : task
      ),
    });
  };

  const deleteTask = (id: number) => {
    setState({ todos: state.todos.filter((task) => task.id !== id) });
  };
  
  return (
    <TasksContext.Provider value={{ tasks: state.todos, addTask, setTaskStatus, deleteTask }}>
      {children}
    </TasksContext.Provider>
  );
};

export const useTasks = () => {
  const context = useContext(TasksContext);
  if (context === undefined) {
    throw new Error("useTasks must be used within a TasksProvider");
  }
  return context;
};
