import React from "react";

interface LoaderProps {
  size?: "sm" | "md" | "lg";
  className?: string;
  fullScreen?: boolean;
}

const sizeClasses = {
  sm: "w-4 h-4",
  md: "w-8 h-8",
  lg: "w-12 h-12",
};

export const Loader: React.FC<LoaderProps> = ({
  size = "lg",
  className = "",
  fullScreen = true,
}) => {
  if (fullScreen) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className={`${sizeClasses[size]} ${className}`}>
          <div className="h-full w-full animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" />
        </div>
      </div>
    );
  }

  return (
    <div className={`inline-block ${sizeClasses[size]} ${className}`}>
      <div className="h-full w-full animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" />
    </div>
  );
};

export default Loader;
