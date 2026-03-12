import { SubTask, Todo } from "@/contexts/TodoContext";
import "../app/globals.css";
import { Handle, Position } from "reactflow";
import DoneRoundedIcon from '@mui/icons-material/DoneRounded';
const ParentNode = ({ data }: { data: Todo }) => {
    // console.log(data, "data from parent");
    return (
        <div style={{
            border: "1px solid lightgray",
            borderRadius: 5,
            padding: 10,
            borderLeftWidth: 5,
            borderLeftColor: data.completed ? "#10B981" : "red",
            backgroundColor: "white",
            maxWidth: 200,
            textAlign: "center",
            color: data.completed ? "#10B981" : "black",
            position: "relative",
        }}>
            <div>{data.text}</div>
            {data.completed && (
                <div style={{
                    position: "absolute",
                    top: -8,
                    right: -8,
                    backgroundColor: "#10B981",
                    borderRadius: "50%",
                    width: 24,
                    height: 24,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "white",
                }}>
                    <DoneRoundedIcon style={{ fontSize: 16 }} />
                </div>
            )}
            <Handle type="target" position={Position.Bottom} />
            <Handle type="source" position={Position.Bottom} />
        </div>
    );
};

const ChildNode = ({ data }: { data: SubTask }) => {
    // console.log(data, "data from child");
    return (
        <div style={{
            border: "1px solid lightgray",
            borderRadius: 5,
            padding: 10,
            borderLeftWidth: 5,
            borderLeftColor: data.completed ? "#10B981" : "red",
            backgroundColor: "white",
            maxWidth: 150,
            textAlign: "center",
            color: data.completed ? "#10B981" : "black",
            position: "relative",
        }}>
            <div>{data.text}</div>
            {data.completed && (
                <div style={{
                    position: "absolute",
                    top: -8,
                    right: -8,
                    backgroundColor: "#10B981",
                    borderRadius: "50%",
                    width: 24,
                    height: 24,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "white",
                }}>
                    <DoneRoundedIcon style={{ fontSize: 16 }} />
                </div>
            )}
            <Handle type="target" position={Position.Top} />
        </div>
    );
};

export { ParentNode, ChildNode };