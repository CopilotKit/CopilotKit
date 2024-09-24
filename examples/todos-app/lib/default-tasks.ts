import { Task, TaskStatus } from "./tasks.types";

export const defaultTasks: Task[] = [
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