import { useTodo } from "@/contexts/TodoContext";
import { useEffect, useState, useCallback } from "react";
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  Position,
} from "reactflow";
import "reactflow/dist/style.css";
import styled from "@emotion/styled";
import { motion } from "framer-motion";

const TodoNode = styled.div`
  padding: 10px 20px;
  border-radius: 8px;
  background: white;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  border: 2px solid ${(props: { completed: boolean }) => 
    props.completed ? "#10B981" : "#E5E7EB"};
  min-width: 150px;
  text-align: center;
  transition: all 0.3s ease;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 8px rgba(0, 0, 0, 0.15);
  }
`;

const NodeContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const NodeTitle = styled.h3`
  margin: 0;
  font-size: 14px;
  color: ${(props: { completed: boolean }) => 
    props.completed ? "#6B7280" : "#1F2937"};
  text-decoration: ${(props: { completed: boolean }) => 
    props.completed ? "line-through" : "none"};
`;

const SubTaskList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
`;

const SubTaskItem = styled.div`
  font-size: 12px;
  color: ${(props: { completed: boolean }) => 
    props.completed ? "#6B7280" : "#4B5563"};
  text-decoration: ${(props: { completed: boolean }) => 
    props.completed ? "line-through" : "none"};
  padding: 4px 8px;
  background: ${(props: { completed: boolean }) => 
    props.completed ? "#F3F4F6" : "#F9FAFB"};
  border-radius: 4px;
`;

const CustomNode = ({ data }: { data: any }) => {
  return (
    <TodoNode completed={data.completed}>
      <NodeContent>
        <NodeTitle completed={data.completed}>{data.label}</NodeTitle>
        {data.subtasks && data.subtasks.length > 0 && (
          <SubTaskList>
            {data.subtasks.map((subtask: any) => (
              <SubTaskItem key={subtask.id} completed={subtask.completed}>
                {subtask.text}
              </SubTaskItem>
            ))}
          </SubTaskList>
        )}
      </NodeContent>
    </TodoNode>
  );
};

const nodeTypes = {
  custom: CustomNode,
};

function VisualRepresentation() {
  const { todos } = useTodo();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedTodo, setSelectedTodo] = useState<number | null>(null);

  const generateGraph = useCallback(() => {
    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];

    if (selectedTodo === null) {
      // Show all parent tasks
      todos.forEach((todo, index) => {
        newNodes.push({
          id: `todo-${todo.id}`,
          type: "custom",
          position: { x: index * 250, y: 100 },
          data: {
            label: todo.text,
            completed: todo.completed,
            subtasks: todo.subtasks,
          },
          sourcePosition: Position.Bottom,
          targetPosition: Position.Top,
        });
      });
    } else {
      // Show selected todo and its subtasks
      const selectedTodoData = todos.find(t => t.id === selectedTodo);
      if (selectedTodoData) {
        // Parent node
        newNodes.push({
          id: `todo-${selectedTodoData.id}`,
          type: "custom",
          position: { x: 0, y: 0 },
          data: {
            label: selectedTodoData.text,
            completed: selectedTodoData.completed,
            subtasks: [],
          },
          sourcePosition: Position.Bottom,
          targetPosition: Position.Top,
        });

        // Subtask nodes
        selectedTodoData.subtasks.forEach((subtask, index) => {
          newNodes.push({
            id: `subtask-${subtask.id}`,
            type: "custom",
            position: { x: (index + 1) * 200, y: 150 },
            data: {
              label: subtask.text,
              completed: subtask.completed,
            },
            sourcePosition: Position.Bottom,
            targetPosition: Position.Top,
          });

          newEdges.push({
            id: `edge-${selectedTodoData.id}-${subtask.id}`,
            source: `todo-${selectedTodoData.id}`,
            target: `subtask-${subtask.id}`,
            animated: true,
            style: { stroke: subtask.completed ? "#10B981" : "#E5E7EB" },
          });
        });
      }
    }

    setNodes(newNodes);
    setEdges(newEdges);
  }, [todos, selectedTodo]);

  useEffect(() => {
    generateGraph();
  }, [generateGraph]);

  const onNodeClick = (event: any, node: Node) => {
    const todoId = parseInt(node.id.split("-")[1]);
    setSelectedTodo(selectedTodo === todoId ? null : todoId);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="h-full w-full"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </motion.div>
  );
}
