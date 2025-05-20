// agent/demo/langgraph_no_chat/Loader.tsx
import React from "react";

const Loader: React.FC<{ size?: number }> = ({ size = 48 }) => (
  <div style={{
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: size,
    width: size,
  }}>
    <div style={{
      border: `${size/8}px solid #e5e7eb`,
      borderTop: `${size/8}px solid #0ea5e9`,
      borderRadius: "50%",
      width: size,
      height: size,
      animation: "spin 1s linear infinite"
    }} />
    <style>
      {`
        @keyframes spin {
          0% { transform: rotate(0deg);}
          100% { transform: rotate(360deg);}
        }
      `}
    </style>
  </div>
);

export default Loader;