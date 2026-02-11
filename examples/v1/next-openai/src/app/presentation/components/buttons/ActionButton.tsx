import clsx from "clsx";

interface ActionButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  inProgress?: boolean;
}

export function ActionButton({ children, onClick, disabled, inProgress }: ActionButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || inProgress}
      className={clsx(
        "text-white font-bold w-7 h-7 flex items-center justify-center rounded-md",
        disabled ? "opacity-50 cursor-not-allowed" : "hover:border hover:border-white",
        inProgress && "animate-bounce text-blue-400 cursor-not-allowed hover:border-none",
      )}
    >
      {children}
    </button>
  );
}
