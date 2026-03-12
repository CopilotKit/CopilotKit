"use client";

import { TasksList } from "@/components/TasksList";
import { TasksProvider } from "@/lib/hooks/use-tasks";

export default function Home() {
  return (
    <TasksProvider>
      <TasksList />
    </TasksProvider>
  );
}
