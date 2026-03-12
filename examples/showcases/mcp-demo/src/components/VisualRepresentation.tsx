import { useTodo } from '@/contexts/TodoContext';
import React, { useEffect, useMemo } from 'react';
import "../app/globals.css";

import {
    Background,
    ReactFlow,
    useNodesState,
    useEdgesState,
    useReactFlow,
    ReactFlowProvider,
    Edge,
    Node,
} from 'reactflow';
import "reactflow/dist/style.css";
import { ChildNode, ParentNode } from './Nodes';



const VisualRepresentation = () => {
    const { todos,toggleTodo,toggleSubtask } = useTodo();
    // const reactFlowWrapper = useRef(null);

    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges] = useEdgesState([]);
    const { fitView } = useReactFlow();

    // This effect calculates nodes/edges based on todos
    useEffect(() => {
        console.log("Calculating nodes/edges based on todos:", todos);
        const units: Node[] = todos.flatMap((item) => {
            if (!item.expanded && todos.length != 1) return [];
            const arr: Node[] = [{
                id: item.id.toString(),
                data: item,
                position: { x: nodes.find((node) => node.id.toString() === item.id.toString())?.position.x || 0 * 100, y: nodes.find((node) => node.id.toString() === item.id.toString())?.position.y || 0 * 100 },
                type: "ParentNode",               
            }]
            if (item.subtasks.length > 0) {
                for (let i = 0; i < item.subtasks.length; i++) {
                    arr.push({
                        id: item.subtasks[i].id.toString(),
                        data: {...item.subtasks[i],parentId:item.id.toString()},
                        position: {
                            x: nodes.find((node) => node.id.toString() === item.subtasks[i].id.toString())?.position.x || (i % 2 == 0 ? -100 : 100),
                            y: nodes.find((node) => node.id.toString() === item.subtasks[i].id.toString())?.position.y || (i % 2 == 0 ? (i * 100) + 100 : ((i - 1) * 100) + 100)
                        },
                        type: "ChildNode",
                    })
                }
            }
            return [...arr];
        });
        setNodes(units);
        const edges: Edge[] = todos.flatMap((item) => {
            if (!item.expanded && todos.length != 1) return [];
            if (item.subtasks.length > 0) {
                let arr = [];
                for (let i = 0; i < item.subtasks.length; i++) {
                    arr.push({
                        id: `${item.id}-${item.subtasks[i].id}`,
                        source: item.id.toString(),
                        target: item.subtasks[i].id.toString(),
                        animated: true,
                    })
                }
                console.log(arr, "arr");
                return [...arr];
            }
            return [];
        })
        setEdges(edges);
    }, [todos]);

    // This separate effect calls fitView when nodes change
    useEffect(() => {
        // Only fit view if there are nodes
        if (nodes.length > 0) {
             console.log("Nodes changed, calling fitView");
            // Call fitView after a short delay
            const timer = setTimeout(() => {
                fitView({ padding: 0.2, duration: 200 });
            }, 50); // Slightly increased delay
            return () => clearTimeout(timer); // Cleanup timeout
        }
    }, [nodes, fitView]);

    // --- Calculate progress (Placeholder logic) ---
    // This assumes we are showing progress for the *first* expanded todo
    // A more robust solution would need context on which task is "active"
    const activeTodo = useMemo(() => todos.find(todo => todo.expanded) || (todos.length > 0 ? todos[0] : null), [todos]);
    const totalSubtasks = useMemo(() => activeTodo?.subtasks.length || 0, [activeTodo]);
    const completedSubtasks = useMemo(() => activeTodo?.subtasks.filter(sub => sub.completed).length || 0, [activeTodo]);
    const progressValue = useMemo(() => (totalSubtasks > 0 ? (completedSubtasks / totalSubtasks) * 100 : 0), [completedSubtasks, totalSubtasks]);
    const taskTitle = useMemo(() => activeTodo?.text || "Task Overview", [activeTodo]);


    return (
        // Wrap existing content in a flex column container
        <div className="flex flex-col h-full">
            {/* Header Section */}
            <div className="mb-4">
                <h2 className="text-xl font-semibold">{taskTitle}</h2>
                <div className="flex items-center gap-2 mt-1 text-sm text-gray-500">
                    <span>{completedSubtasks} of {totalSubtasks} subtasks completed</span>
                    <div className="w-[100px] h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-blue-500" 
                        style={{ width: `${progressValue}%` }}
                      ></div>
                    </div>
                </div>
            </div>

            {/* Visualization Label */}
            <h3 className="text-lg font-medium mb-2">Task Visualization Tree</h3>

            {/* React Flow Area - make it flexible */}
            <div className="flex-1 w-full h-full border rounded-md"> {/* Added border and rounded */}
                <ReactFlow
                    style={{ backgroundColor: "#F7F9FB" }}
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onNodeClick={(event, node) => {
                        if(node.type == "ParentNode"){
                            // Only toggle if there's more than one todo, otherwise it collapses the only view
                            if (todos.length > 1) {
                                toggleTodo(node.data.id);
                            }
                        }
                        else{
                            toggleSubtask(parseInt(node.data.parentId), node.data.id);
                        }
                    }}
                    // fitView // Consider re-enabling fitView if needed
                    defaultViewport={{ x: 200, y: 100, zoom: 1 }}
                    nodeTypes={nodeTypes}
                    proOptions={{ hideAttribution: true }} // Hide React Flow attribution
                >
                    <Background />
                </ReactFlow>
            </div>
        </div>
    );
};


const nodeTypes = {
    ParentNode: ParentNode,
    ChildNode: ChildNode,
}
export default function Test() {
    return (
        <ReactFlowProvider>
            <VisualRepresentation />
        </ReactFlowProvider>
    );
}