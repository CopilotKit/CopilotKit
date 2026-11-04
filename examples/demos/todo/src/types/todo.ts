export interface Todo {
  id: string;
  text: string;
  isCompleted: boolean;
  assignedTo?: string;
}
